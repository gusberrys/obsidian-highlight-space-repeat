import { writeFile } from 'fs/promises';

const OUTPUT_FILE = 'styles.css';

const banner = `/* ========================================================================
   THIS FILE IS AUTO-GENERATED - DO NOT EDIT DIRECTLY!

   Edit files in styles/ directory instead, then run:
   npm run build:css
   ======================================================================== */

`;

async function cleanCSS() {
    try {
        await writeFile(OUTPUT_FILE, banner, 'utf-8');
        console.log('✅ Cleaned styles.css - banner only. Run "npm run build:css" to rebuild.');
    } catch (error) {
        console.error('❌ Error cleaning CSS:', error);
        process.exit(1);
    }
}

cleanCSS();
