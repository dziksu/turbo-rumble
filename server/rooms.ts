import { randomBytes, randomUUID } from 'node:crypto';
import { Race } from '../shared/simulation.ts';
import type { ActivityCounts } from '../shared/activity.ts';
import { MAX_PLAYERS } from '../shared/rules.ts';
import type { Session } from '../shared/types.ts';
import type { HostCommand, ServerStats } from '../shared/protocol.ts';

export interface Room {
  code: string;
  hostToken: string;
  race: Race;
  players: Map<string, string>;
  playerSockets: Map<string, string>;
  disconnectedSince: Map<string, number>;
  hosts: Set<string>;
  emptySince: number | null;
  hostLost: number;
  matchId: string;
  saved: boolean;
}
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = [
  'Nitro Nela',
  'Bumper Bruno',
  'Rakieta Róża',
  'Drift Darek',
  'Mina Mila',
  'Turbo Teo',
  'Frost Franek',
  'Puls Pola',
];
const newToken = () => randomBytes(24).toString('base64url');
export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}
export class RoomRegistry {
  readonly rooms = new Map<string, Room>();
  constructor(
    private readonly maxRooms = 50,
    private readonly playerReconnectMs = 30_000,
  ) {}
  stats(): ServerStats {
    let players = 0,
      activeRooms = 0;
    for (const room of this.rooms.values()) {
      let online = 0;
      for (const car of room.race.cars.values())
        if (!car.bot && car.connected && room.playerSockets.has(car.id)) online++;
      players += online;
      if (room.hosts.size || online) activeRooms++;
    }
    return { players, activeRooms, rooms: this.rooms.size, maxRooms: this.maxRooms };
  }
  activity(): ActivityCounts {
    const { players, activeRooms } = this.stats();
    let playingPlayers = 0;
    for (const room of this.rooms.values()) {
      if (!room.hosts.size || !['countdown', 'racing', 'segment'].includes(room.race.phase))
        continue;
      for (const car of room.race.cars.values())
        if (!car.bot && car.connected && room.playerSockets.has(car.id)) playingPlayers++;
    }
    return { players, playingPlayers, activeRooms };
  }
  create(): { room: Room; session: Session } {
    if (this.rooms.size >= this.maxRooms)
      throw new RoomError('Za dużo pokojów. Spróbuj ponownie za minutę.', 429);
    let code: string;
    do {
      code = Array.from(randomBytes(6), (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      hostToken: newToken(),
      race: new Race(randomBytes(4).readUInt32LE()),
      players: new Map(),
      playerSockets: new Map(),
      disconnectedSince: new Map(),
      hosts: new Set(),
      emptySince: Date.now(),
      hostLost: 0,
      matchId: randomUUID(),
      saved: false,
    };
    this.rooms.set(code, room);
    return { room, session: { code, token: room.hostToken, role: 'host' } };
  }
  join(code: string, name: string): { room: Room; session: Session } {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('Nie ma takiego pokoju. Sprawdź kod na ekranie hosta.', 404);
    this.expireDisconnected(room);
    if (!['lobby', 'finished', 'countdown'].includes(room.race.phase))
      throw new RoomError('Wyścig już trwa. Dołącz, gdy host wróci do lobby.', 409);
    if (room.race.cars.size >= MAX_PLAYERS)
      throw new RoomError('Wszystkie 8 miejsc jest zajętych.', 409);
    if (room.race.phase === 'countdown') room.race.lobby();
    const id = randomUUID(),
      key = newToken();
    room.race.addDriver({
      id,
      name,
      slot: this.nextSlot(room),
      bot: false,
      connected: false,
      ready: false,
      wins: 0,
    });
    room.players.set(key, id);
    room.disconnectedSince.set(id, Date.now());
    return { room, session: { code, token: key, playerId: id, role: 'player' } };
  }
  authenticate(session: Session) {
    const room = this.rooms.get(session.code);
    if (!room) return null;
    this.expireDisconnected(room);
    if (session.role === 'host' && session.token === room.hostToken)
      return { room, host: true, playerId: undefined };
    const playerId = session.role === 'player' ? room.players.get(session.token) : undefined;
    return playerId ? { room, host: false, playerId } : null;
  }
  playerConnected(room: Room, id: string) {
    room.disconnectedSince.delete(id);
    room.race.setConnected(id, true);
    this.nominateAdmin(room);
  }
  playerDisconnected(room: Room, id: string) {
    room.race.setConnected(id, false);
    const car = room.race.cars.get(id);
    if (car && !car.bot) room.disconnectedSince.set(id, Date.now());
  }
  expireDisconnected(room: Room, now = Date.now()) {
    let removed = false;
    for (const [id, since] of room.disconnectedSince) {
      const car = room.race.cars.get(id);
      if (!car || car.bot || car.connected || room.playerSockets.has(id)) {
        room.disconnectedSince.delete(id);
        continue;
      }
      if (now - since < this.playerReconnectMs) continue;
      this.removePlayer(room, id);
      removed = true;
    }
    if (removed) this.syncLobby(room);
    return removed;
  }
  private nominateAdmin(room: Room) {
    room.race.adminId ??=
      [...room.race.cars.values()].find(
        (car) => !car.bot && car.connected && room.playerSockets.has(car.id),
      )?.id ?? null;
  }
  private removePlayer(room: Room, id: string) {
    const socket = room.playerSockets.get(id);
    room.race.removeDriver(id);
    room.playerSockets.delete(id);
    room.disconnectedSince.delete(id);
    for (const [key, playerId] of room.players) if (playerId === id) room.players.delete(key);
    if (room.race.adminId === id) room.race.adminId = null;
    this.nominateAdmin(room);
    return socket;
  }
  command(room: Room, command: HostCommand): string | undefined {
    let removedSocket: string | undefined;
    switch (command.action) {
      case 'start':
        this.requireLobby(room, 'Wyścig już trwa.');
        room.race.start();
        room.matchId = randomUUID();
        room.saved = false;
        break;
      case 'lobby':
        room.race.lobby();
        for (const car of room.race.cars.values()) if (!car.bot) car.ready = false;
        break;
      case 'settings': {
        this.requireLobby(room, 'Ustawienia zmieniasz przed startem.');
        const old = room.race;
        if (command.settings.mapId !== old.settings.mapId) {
          const next = new Race(old.seed, command.settings);
          next.adminId = old.adminId;
          for (const car of old.cars.values()) next.addDriver({ ...car, ready: car.bot });
          room.race = next;
          old.dispose();
        } else {
          old.settings = { ...command.settings };
          for (const car of old.cars.values()) if (!car.bot) car.ready = false;
          old.lobby();
        }
        break;
      }
      case 'bot': {
        this.requireLobby(room, 'Boty dodajesz w lobby.');
        if (room.race.cars.size >= MAX_PLAYERS)
          throw new RoomError('Wszystkie 8 miejsc jest zajętych.', 409);
        const slot = this.nextSlot(room);
        room.race.addDriver({
          id: randomUUID(),
          name: BOT_NAMES[slot],
          slot,
          bot: true,
          ready: true,
          connected: true,
          wins: 0,
        });
        break;
      }
      case 'remove':
        this.requireLobby(room, 'Graczy usuwasz w lobby.');
        removedSocket = this.removePlayer(room, command.id);
        break;
    }
    return removedSocket;
  }
  syncLobby(room: Room) {
    const race = room.race;
    const allReady =
      race.cars.size >= 2 &&
      [...race.cars.values()].every((car) => car.bot || (car.connected && car.ready));
    if (race.phase === 'countdown' && !allReady) race.lobby();
    if (
      race.phase === 'lobby' &&
      allReady &&
      room.hosts.size &&
      [...race.cars.values()].some((car) => !car.bot)
    ) {
      race.start();
      room.matchId = randomUUID();
      room.saved = false;
    }
  }
  dispose(code: string) {
    const room = this.rooms.get(code);
    if (room) {
      room.race.dispose();
      this.rooms.delete(code);
    }
  }
  disposeAll() {
    for (const code of this.rooms.keys()) this.dispose(code);
  }
  private nextSlot(room: Room) {
    const used = new Set([...room.race.cars.values()].map((c) => c.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }
  private requireLobby(room: Room, message: string) {
    if (!['lobby', 'finished'].includes(room.race.phase)) throw new RoomError(message, 409);
  }
}
