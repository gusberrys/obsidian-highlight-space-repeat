import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const STYLES_DIR = 'styles';
const OUTPUT_FILE = 'styles.css';

async function buildCSS() {
    try {
        // Read all CSS files from styles/
        const files = await readdir(STYLES_DIR);
        const cssFiles = files.filter(file => file.endsWith('.css')).sort();

        if (cssFiles.length === 0) {
            console.warn('⚠️  No CSS files found in styles/');
            return;
        }

        // Read and concatenate all CSS files
        const cssContents = await Promise.all(
            cssFiles.map(async file => {
                const content = await readFile(join(STYLES_DIR, file), 'utf-8');
                return `/* ${file} */\n${content}\n`;
            })
        );

        // Write concatenated CSS to output file
        const banner = `/* ========================================================================
   THIS FILE IS AUTO-GENERATED - DO NOT EDIT DIRECTLY!

   Edit files in styles/ directory instead, then run:
   npm run build:css
   ======================================================================== */\n\n`;
        const finalCSS = banner + cssContents.join('\n');

        await writeFile(OUTPUT_FILE, finalCSS, 'utf-8');

        console.log(`✅ Built ${OUTPUT_FILE} from ${cssFiles.length} source files:`);
        cssFiles.forEach(file => console.log(`   - ${file}`));
    } catch (error) {
        console.error('❌ Error building CSS:', error);
        process.exit(1);
    }
}

buildCSS();
