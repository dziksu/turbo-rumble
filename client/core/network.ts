import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.ts';
import type { Input, Session } from '../../shared/types.ts';
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const connectGame = (auth: Session): GameSocket => io({ auth });
export function createInput(socket: GameSocket) {
  let seq = 0,
    actionSeq = 0,
    left = false,
    right = false;
  const send = () => {
    if (socket.connected)
      socket.emit('input', { seq: ++seq, left, right, actionSeq } satisfies Input);
  };
  const onConnect = () => {
    seq = 0;
    actionSeq = 0;
    left = false;
    right = false;
    send();
  };
  socket.on('connect', onConnect);
  const timer = setInterval(send, 33);
  const reset = () => {
    left = false;
    right = false;
    send();
  };
  window.addEventListener('blur', reset);
  const visibility = () => {
    if (document.hidden) reset();
  };
  document.addEventListener('visibilitychange', visibility);
  return {
    set(l: boolean, r: boolean) {
      left = l;
      right = r;
      send();
    },
    fire() {
      actionSeq++;
      send();
    },
    reset,
    dispose() {
      clearInterval(timer);
      socket.off('connect', onConnect);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
