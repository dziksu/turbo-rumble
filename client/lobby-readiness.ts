import type { CarState } from '../shared/types.ts';

type LobbyDriver = Pick<CarState, 'bot' | 'connected' | 'ready'>;

export function playerReadiness(car: LobbyDriver) {
  if (car.bot) return 'bot';
  if (!car.connected) return 'disconnected';
  return car.ready ? 'ready' : 'waiting';
}

export function lobbyReadiness(cars: readonly LobbyDriver[]) {
  const humans = cars.filter((car) => !car.bot);
  return {
    ready: humans.filter((car) => playerReadiness(car) === 'ready').length,
    total: humans.length,
  };
}
