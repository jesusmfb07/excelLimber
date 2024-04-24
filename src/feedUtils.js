export { processData, isFeedWorking,checkFeedCompleteness };
import { LIMIT_CONSTANT, DATA_FILE, ERROR_FEEDS_FILE, RUNNING_FEEDS_FILE } from './constants.js';
import { writeResultsToFile, writeFileData } from './fileUtils.js';
import xml2js from 'xml2js';
import fetch from "node-fetch";
import pLimit from "p-limit";
import fs from "fs";
import JSONStream from "JSONStream";
import { Transform } from 'stream';

const limit = pLimit(LIMIT_CONSTANT);
let flowNumber = 0;

async function validate(data){
  return /^<\?xml/i.test(data)
}

async function isFeedWorking(feedUrl) {
  try {
    const startTime = Date.now();
    // Waiting the url response
    const response = await fetch(feedUrl, { agent: null });
    // Capturing the end time: optional
    const durationInfoInMilliseconds = Date.now() - startTime;
    // Capturing content size: optional
    const contentLengthHeader = response.headers.get("content-length");
    const pageSizeInBytes = contentLengthHeader != null ? parseInt(contentLengthHeader) : 0;

    // Case response has no content or response 404
    if (!response.ok) {
      if (response.status === 404) {
        return {
          isWorking: false,
          errorMessage: "Error 404: Not Found",
          pageSizeInBytes,
          durationInfoInMilliseconds,
          accessRestricted: false,
        };
      } else {
        return {
          isWorking: false,
          errorMessage: "Access to the feed is restricted",
          pageSizeInBytes,
          durationInfoInMilliseconds,
          accessRestricted: true,
        };
      }
    }

    const data = await response.text();
    const isContentXML = validate(data);
    const isContentHTML = /<html.*>/i.test(data);

    // Case response has no XML content
    if (isContentHTML || !isContentXML) {
      return {
        isWorking: false,
        errorMessage: "Is not XML file",
        pageSizeInBytes,
        durationInfoInMilliseconds,
        accessRestricted: false,
      };
    }

    // XML to Json converter
    const parser = new xml2js.Parser();

    const parsedData = await parser.parseStringPromise(data);
    const xmlData = parsedData.rss;

    if (!xmlData) {
      return {
        isWorking: false,
        errorMessage: "No RSS data found",
        pageSizeInBytes,
        durationInfoInMilliseconds,
        accessRestricted: false,
      };
    }

    if (xmlData.$.version != "2.0") {
      return {
        isWorking: false,
        errorMessage: "Invalid feed version",
        pageSizeInBytes,
        durationInfoInMilliseconds,
        accessRestricted: false,
      };
    }

    return {
      isWorking: true,
      errorMessage: "No Error",
      pageSizeInBytes,
      durationInfoInMilliseconds,
      accessRestricted: false,
    };
  } catch (error) {
    console.error("ENOTFOUND:", error.message);
    return {
      isWorking: false,
      errorMessage: error.message,
      pageSizeInBytes: 0,
      durationInfoInMilliseconds: 0,
      accessRestricted: false,
    };
  }
}

async function checkFeedCompleteness(feedUrl) {
  try {
    const response = await fetch(feedUrl, { agent: null });
    const data = await response.text();

    if (!response.ok || !validate(data)) {
      return false; // El feed no es XML válido, por lo que se considera incorrecto
    }

    const parser = new xml2js.Parser();
    const parsedData = await parser.parseStringPromise(data);
    const rss = parsedData.rss;

    if (!rss) {
      return false; // El archivo no contiene datos RSS válidos, por lo que se considera incorrecto
    }

    const channel = rss.channel && rss.channel[0];

    if (!channel) {
      return false; // No hay un canal RSS válido, por lo que se considera incorrecto
    }

    const title = channel.title && channel.title[0];
    const description = channel.description && channel.description[0];
    const link = channel.link && channel.link[0];
    const items = channel.item;

    // Verifica si el canal tiene un título, una descripción, un enlace y al menos un elemento de artículo
    if (!title || !description || !link || !items || items.length === 0) {
      return false; // El canal RSS no contiene los elementos mínimos necesarios, por lo que se considera incorrecto
    }

    // Verifica si cada elemento de artículo tiene un título y una descripción
    const incompleteItems = items.some(
      (item) => !item.title || !item.description
    );

    if (incompleteItems) {
      return false; // Hay al menos un artículo incompleto, por lo que se considera incorrecto
    }

    return true; // El feed XML es completo y funcional, por lo que se considera correcto
  } catch (error) {
    console.error("Error checking feed completeness:", error);
    return false; // En caso de error, se considera incorrecto
  }
}

async function processData(filename) {
  console.log(`Starting processing of ${filename}...`);
  const errorFeeds = [];
  const runningFeeds = [];
  const feedDataStream = fs
    .createReadStream(filename)
    .pipe(JSONStream.parse("*"))
    .pipe(
      new Transform({
        objectMode: true,
        async transform(chunk, encoding, callback) {
          // 1. No verificar limber.feed.linkedin
          if (chunk.feedUrl.includes("limber.feed.linkedin")) {
            callback();
            return;
          }

          console.log(`this is ${chunk.feedUrl}...`);
          flowNumber++;
          console.log(`this is flow number ${flowNumber}...`);
          chunk.flowNumber = flowNumber;
          console.log(`flowNumber ${chunk.flowNumber}...`);
          console.log(`chunk ID ${chunk._id}...`);

          if (chunk.ID) {
            console.log(`Flow number: ${chunk.ID}`);
            totalProcessedFlows++;
            console.log(`${totalProcessedFlows} flows have been processed so far.`);
          }

          const {
            isWorking,
            errorMessage,
            pageSizeInBytes,
            durationInfoInMilliseconds,
            accessRestricted,
          } = await isFeedWorking(chunk.feedUrl);
          const isRunningState = ["TO_READ", "IDLE", "READING"].includes(chunk.status);

          console.log(`const: ${
            isWorking} 
            ${errorMessage}
            ${pageSizeInBytes}
            ${durationInfoInMilliseconds}
            ${accessRestricted}...`);

          // 2. Filtrar archivos XML que no tengan una descripción o estén vacíos
          const isIncorrecto = !(await checkFeedCompleteness(chunk.feedUrl)); //await checkFeedCompleteness(chunk.feedUrl);


          if (chunk.status === "TO_BE_READ_BY_LIMBER_CRAWLER") {
            chunk.pageSizeInBytes = "N.A";
            chunk.durationInfoInMilliseconds = "N.A";
            chunk.accesoRestringido = "NO";
            runningFeeds.push(chunk);
          } else if (isWorking || isRunningState) {
            if (pageSizeInBytes === 0 && durationInfoInMilliseconds > 0) {
              chunk.pageSizeInBytes = 0;
              chunk.accesoRestringido = "YES";
            } else {
              chunk.pageSizeInBytes = pageSizeInBytes;
              chunk.accesoRestringido = "NO";
              chunk.durationInfoInMilliseconds = durationInfoInMilliseconds;

              // 3. Verificar archivos NOT_AVAILABLE o READING_ERROR que puedan tener un XML funcional
              if (
                chunk.status === "NOT_AVAILABLE" ||
                chunk.status === "READING_ERROR"
              ) {
                if (!isIncorrecto) {
                  chunk.isCorrecto = true;
                  runningFeeds.push(chunk);
                } else {
                  errorFeeds.push(chunk);
                }
              } else {
                chunk.isCorrecto = !isIncorrecto;
                runningFeeds.push(chunk);
              }
            }
          } else if (errorMessage) {
            // 4. Eliminar el mensaje de error 'invalid feed version' en errorFeeds.json
            if (
              errorMessage === "Invalid feed version" &&
              (chunk.status === "NOT_AVAILABLE" ||
                chunk.status === "READING_ERROR")
            ) {
              if (!isIncorrecto) {
                chunk.isCorrecto = true;
                runningFeeds.push(chunk);
              } else {
                errorFeeds.push(chunk);
              }
            } else {
              chunk.error = errorMessage;
              chunk.pageSizeInBytes = pageSizeInBytes;
              chunk.durationInfoInMilliseconds = durationInfoInMilliseconds;
              if (accessRestricted) {
                chunk.error = "Access to the feed is restricted";
              }
              errorFeeds.push(chunk);
            }
          } else {
            // 5. Validar si el archivo tiene contenido o está vacío
            if (!isIncorrecto) {
              chunk.isCorrecto = true;
              runningFeeds.push(chunk);
            } else {
              errorFeeds.push(chunk);
            }
          }

          // 6. Asegurarse de que pageSizeInBytes tenga la cantidad correcta de bytes
          if (chunk.pageSizeInBytes === "N.A") {
            chunk.pageSizeInBytes = pageSizeInBytes;
          }

          // 7. No traer información innecesaria
          delete chunk.statusUpdatedOn;
          delete chunk.readingErrorAt;

          callback();
        },
      })
    );

  await new Promise((resolve) => {
    feedDataStream.on("finish", async () => {
      console.log(`--------------errorFeeds: ${errorFeeds.length}:`);
      console.log(`--------------runningFeeds: ${runningFeeds.length}:`);
      console.log(`Processing of ${filename} finished.`);
      console.log("Writing data");
      await writeResultsToFile(ERROR_FEEDS_FILE, errorFeeds);
      await writeResultsToFile(RUNNING_FEEDS_FILE, runningFeeds);
      console.log("Finished writing data");
      feedDataStream.on("error", (error) => {
        console.error(`Error in data stream of ${filename}:`, error);
      });
      resolve();
    });
  });
}

  