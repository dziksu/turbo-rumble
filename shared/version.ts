import metadata from '../package.json' with { type: 'json' };

/** One version source for the browser bundle and the server health response. */
export const GAME_VERSION = metadata.version;
