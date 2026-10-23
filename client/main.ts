import '@fontsource/bungee/latin.css';
import '@fontsource/bungee/latin-ext.css';
import '@fontsource/space-grotesk/latin-ext.css';
import './style.css';
import './shared-screen.css';
import './cinematic-home.css';
import { app, toast } from './core/dom.ts';
import { home } from './pages/home.ts';
import { joinPage } from './pages/join.ts';
import { roomPage } from './pages/room.ts';
import { hostPage } from './pages/host.ts';

const route = location.pathname;
if (import.meta.env.DEV && route === '/map-check')
  void import('./map-check.ts').then((m) => m.mountMapCheck(app));
else if (import.meta.env.DEV && route === '/equipment-check')
  void import('./equipment-check.ts').then((m) => m.mountEquipmentCheck(app));
else if (import.meta.env.DEV && route === '/handling-check')
  void import('./handling-check.ts').then((m) => m.mountHandlingCheck(app));
else if (import.meta.env.DEV && route === '/audio-check')
  void import('./audio-check.ts').then((m) => m.mountAudioCheck(app));
else if (route.startsWith('/room/'))
  void roomPage(route.split('/')[2]).catch((e: Error) => toast(e.message));
else if (route.startsWith('/watch/'))
  void hostPage(route.split('/')[2], true).catch((e: Error) => toast(e.message));
else if (route.startsWith('/host/'))
  void hostPage(route.split('/')[2]).catch((e) => toast(e.message));
else if (route.replace(/\/+$/, '') === '/stats')
  void import('./pages/stats.ts').then((m) => m.statsPage());
else if (route === '/author') void import('./pages/author.ts').then((m) => m.authorPage());
else if (route === '/credits') void import('./pages/credits.ts').then((m) => m.creditsPage());
else if (route === '/join') void joinPage();
else void home();
