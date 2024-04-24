import { processData } from './feedUtils.js';
import { RUNNING_FEEDS_FILE, ERROR_FEEDS_FILE } from './constants.js';
import { writeResultsToFile } from './fileUtils.js';
import { filterFeedData } from './feedUtils.js';

filterFeedData('data.json');


async function main() {
  try {
    const runningFeeds = [];
    const errorFeeds = [];

    await processData((chunk) => {
      if (chunk.feedUrl.includes('limber.feed.linkedin')) {
        return; // Omitir los flujos con la URL limber.feed.linkedin
      }

      if (chunk.isWorking || ['TO_READ', 'IDLE', 'READING'].includes(chunk.createdOn)) {
        runningFeeds.push(chunk);
      } else {
        errorFeeds.push(chunk);
      }
    });

    await writeResultsToFile(RUNNING_FEEDS_FILE, runningFeeds);
    await writeResultsToFile(ERROR_FEEDS_FILE, errorFeeds);
  } catch (error) {
    console.error('Error in main:', error);
  }
}

main();
