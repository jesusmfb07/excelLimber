// fileUtils.js
import fs from 'fs';

async function writeResultsToFile(filename, data) {
  try {
    await fs.promises.writeFile(filename, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Data has been saved in ${filename}`);
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
  }
}

export { writeResultsToFile };