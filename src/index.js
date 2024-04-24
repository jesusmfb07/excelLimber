import { processData } from './feedUtils.js';
import { DATA_FILE } from './constants.js';

async function main() {
  try {
    await processData(DATA_FILE)
  } catch (error) {
    console.error('Error in main:', error);
  }
}

main();
