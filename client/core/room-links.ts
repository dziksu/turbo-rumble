import { api } from './api.ts';
import type { NetworkInfo } from '../../shared/protocol.ts';

/** Public links never include the host fragment or a saved session token. */
export async function roomLinks(code: string) {
  const info = await api<NetworkInfo>('/api/info').catch(() => null);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const base =
    info?.publicUrl ?? (loopback ? (info?.networkUrls[0] ?? location.origin) : location.origin);
  return {
    base,
    room: base + '/room/' + encodeURIComponent(code),
    controller: base + '/join?code=' + encodeURIComponent(code) + '&mode=controller',
  };
}
