// Must be imported before anything renders text with sharp: points fontconfig at the bundled fonts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.FONTCONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts', 'fonts.conf');
// macOS defaults Pango to CoreText, which ignores fontconfig fonts; Linux (Vercel) already uses fontconfig
process.env.PANGOCAIRO_BACKEND = 'fc';
