import type { Server, Socket } from 'socket.io';
import {
  isInput,
  parseHostCommand,
  parseSession,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../shared/protocol.ts';
import type { Room, RoomRegistry } from './rooms.ts';

interface SocketData {
  room: Room;
  host: boolean;
  playerId?: string;
}
export type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export function registerRealtime(
  io: GameServer,
  registry: RoomRegistry,
  activityChanged = () => {},
) {
  const broadcast = (room: Room) => io.to(room.code).emit('state', room.race.snapshot(room.code));
  io.use((socket, next) => {
    const session = parseSession(socket.handshake.auth);
    const identity = session && registry.authenticate(session);
    if (!identity) {
      next(new Error('Nieprawidłowa sesja lub pokój wygasł. Dołącz ponownie.'));
      return;
    }
    Object.assign(socket.data, identity);
    next();
  });
  io.on('connection', (socket: GameSocket) => {
    const { room, playerId, host } = socket.data;
    void socket.join(room.code);
    const wasEmpty = room.emptySince !== null;
    room.emptySince = null;
    const ownsController = () => !!playerId && room.playerSockets.get(playerId) === socket.id;
    if (host) {
      room.hosts.add(socket.id);
      room.hostLost = 0;
      room.race.resume();
    } else if (playerId) {
      // A phone returning first gets a fresh grace period for the host to reconnect.
      if (wasEmpty && room.hostLost) room.hostLost = Date.now();
      const previous = room.playerSockets.get(playerId);
      room.playerSockets.set(playerId, socket.id);
      if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true);
      room.race.resetInput(playerId);
      registry.playerConnected(room, playerId);
    }
    let inputs = 0,
      bucketStarted = Date.now();
    socket.on('input', (input) => {
      if (!ownsController() || !isInput(input)) return;
      if (Date.now() - bucketStarted >= 1000) {
        inputs = 0;
        bucketStarted = Date.now();
      }
      if (++inputs <= 100) room.race.input(playerId!, input);
    });
    socket.on('ready', (ready, ack) => {
      if (
        !ownsController() ||
        typeof ready !== 'boolean' ||
        !['lobby', 'finished', 'countdown'].includes(room.race.phase)
      )
        return;
      const car = room.race.cars.get(playerId!);
      if (car) car.ready = ready;
      if (room.race.phase === 'finished' && ready) room.race.lobby();
      registry.syncLobby(room);
      activityChanged();
      broadcast(room);
      if (typeof ack === 'function') ack();
    });
    socket.on('ping-time', (ack) => {
      if (typeof ack === 'function') ack();
    });
    socket.on('host', (payload, ack) => {
      const respond = (result: Parameters<NonNullable<typeof ack>>[0]) => {
        if (typeof ack === 'function') ack(result);
      };
      const command = parseHostCommand(payload);
      const admin = ownsController() && playerId === room.race.adminId;
      if (!host && !admin) {
        respond({ ok: false, error: 'To działanie jest dostępne dla administratora pokoju.' });
        return;
      }
      if (!command) {
        respond({ ok: false, error: 'Nieznane polecenie.' });
        return;
      }
      try {
        if (command.action === 'start' && room.race.phase === 'countdown') {
          respond({ ok: true });
          return;
        }
        const removedSocket = registry.command(room, command);
        registry.syncLobby(room);
        if (removedSocket) io.sockets.sockets.get(removedSocket)?.disconnect(true);
        activityChanged();
        broadcast(room);
        respond({ ok: true });
      } catch (error) {
        respond({
          ok: false,
          error: error instanceof Error ? error.message : 'Nie udało się wykonać polecenia.',
        });
      }
    });
    socket.on('disconnect', () => {
      if (host) {
        room.hosts.delete(socket.id);
        if (!room.hosts.size) {
          room.hostLost = Date.now();
          room.race.pause();
        }
      } else if (playerId && ownsController()) {
        room.playerSockets.delete(playerId);
        registry.playerDisconnected(room, playerId);
      }
      if (!io.sockets.adapter.rooms.get(room.code)?.size) room.emptySince ??= Date.now();
      registry.syncLobby(room);
      activityChanged();
      broadcast(room);
    });
    registry.syncLobby(room);
    activityChanged();
    socket.emit('session', { playerId: playerId ?? null });
    broadcast(room);
  });
  return broadcast;
}
