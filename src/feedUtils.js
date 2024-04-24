// feedUtils.js
export { filterFeedData, processData, isFeedWorking, checkFeedCompleteness };
import fetch from "node-fetch";
import pLimit from "p-limit";
import fs from "fs";
import JSONStream from "JSONStream";
import { Transform } from 'stream';

const limit = pLimit(10);

async function isFeedWorking(feedUrl) {
  try {
    const startTime = Date.now();
    const response = await fetch(feedUrl, { agent: null });
    const endTime = Date.now();
    const durationInfoInMilliseconds = endTime - startTime;
    const pageSizeInBytes =
      parseInt(response.headers.get("content-length"), 10) || 0;

    if (!response.ok) {
      if (response.status === 404) {
        return {
          isWorking: false,
          errorMessage: "Error 404: Not Found",
          pageSizeInBytes,
          durationInfoInMilliseconds,
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

    if (isContentHTML || !isContentXML) {
      return {
        isWorking: false,
        errorMessage: "The file is not XML",
        pageSizeInBytes,
        durationInfoInMilliseconds,
      };
    }

    const parser = new xml2js.Parser();
    const parsedData = await parser.parseStringPromise(data);
    const xmlData = parsedData.rss;

    if (!xmlData) {
      return {
        isWorking: false,
        errorMessage: "No RSS data found",
        pageSizeInBytes,
        durationInfoInMilliseconds,
      };
    }

    if (!xmlData["@"] || xmlData["@"].version !== "2.0") {
      return {
        isWorking: false,
        errorMessage: "Invalid feed version",
        pageSizeInBytes,
        durationInfoInMilliseconds,
      };
    }

    if (!xmlData.channel[0].image || xmlData.channel[0].image.length < 2) {
      return {
        isWorking: false,
        errorMessage: "Feed does not have enough images",
        pageSizeInBytes,
        durationInfoInMilliseconds,
      };
    }

    if (!xmlData.channel[0].title || xmlData.channel[0].title[0].length < 3) {
      return {
        isWorking: false,
        errorMessage: "Feed title is too short",
        pageSizeInBytes,
        durationInfoInMilliseconds,
      };
    }

    return {
      isWorking: true,
      pageSizeInBytes,
      durationInfoInMilliseconds,
    };
  } catch (error) {
    console.error("ENOTFOUND:", error.message);
    return {
      isWorking: false,
      errorMessage: "ENOTFOUND",
      pageSizeInBytes: 0,
      durationInfoInMilliseconds: 0,
    };
  }
}

async function checkFeedCompleteness(feedUrl) {
  try {
    const response = await fetch(feedUrl, { agent: null });
    const data = await response.text();

    if (!response.ok || !validate(data)) {
      return true; // El feed no es XML válido, por lo que se considera incorrecto
    }

    const parser = new xml2js.Parser();
    const parsedData = await parser.parseStringPromise(data);
    const rss = parsedData.rss;

    if (!rss) {
      return true; // El archivo no contiene datos RSS válidos, por lo que se considera incorrecto
    }

    const channel = rss.channel && rss.channel[0];

    if (!channel) {
      return true; // No hay un canal RSS válido, por lo que se considera incorrecto
    }

    const title = channel.title && channel.title[0];
    const description = channel.description && channel.description[0];
    const link = channel.link && channel.link[0];
    const items = channel.item;

    // Verifica si el canal tiene un título, una descripción, un enlace y al menos un elemento de artículo
    if (!title || !description || !link || !items || items.length === 0) {
      return true; // El canal RSS no contiene los elementos mínimos necesarios, por lo que se considera incorrecto
    }

    // Verifica si cada elemento de artículo tiene un título y una descripción
    const incompleteItems = items.some(
      (item) => !item.title || !item.description
    );

    if (incompleteItems) {
      return true; // Hay al menos un artículo incompleto, por lo que se considera incorrecto
    }

    return false; // El feed XML es completo y funcional, por lo que se considera correcto
  } catch (error) {
    console.error("Error checking feed completeness:", error);
    return true; // En caso de error, se considera incorrecto
  }
}

async function filterFeedData(filename) {
  console.log(`Starting processing of ${filename}...`);
  const limit = pLimit(20);

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

          flowNumber++;
          chunk.flowNumber = flowNumber;

          if (chunk.ID) {
            console.log(`Flow number: ${chunk.ID}`);
            totalProcessedFlows++;
            console.log(
              `${totalProcessedFlows} flows have been processed so far.`
            );
          }

          const {
            isWorking,
            errorMessage,
            pageSizeInBytes,
            durationInfoInMilliseconds,
            accessRestricted,
          } = await limit(() => isFeedWorking(chunk.feedUrl));
          const isRunningState = ["TO_READ", "IDLE", "READING"].includes(
            chunk.createdOn
          );

          // 2. Filtrar archivos XML que no tengan una descripción o estén vacíos
          const isIncorrecto = await checkFeedCompleteness(chunk.feedUrl);

          if (chunk.createdOn === "TO_BE_READ_BY_LIMBER_CRAWLER") {
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
                chunk.createdOn === "NOT_AVAILABLE" ||
                chunk.createdOn === "READING_ERROR"
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
              (chunk.createdOn === "NOT_AVAILABLE" ||
                chunk.createdOn === "READING_ERROR")
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

  feedDataStream.on("finish", () => {
    console.log(`Processing of ${filename} finished.`);
    writeResultsToFile(); // Se llama a writeResultsToFile después de que se procesen todos los flujos de datos
  });

  feedDataStream.on("error", (error) => {
    console.error(`Error in data stream of ${filename}:`, error);
  });
}

async function processData() {
  const runningFlows = [];
  const errorFeeds = [];

  await filterFeedData(async (chunk) => {
    const {
      isWorking,
      errorMessage,
      pageSizeInBytes,
      durationInfoInMilliseconds,
      accessRestricted,
    } = await limit(() => isFeedWorking(chunk.feedUrl));

    chunk.pageSizeInBytes = pageSizeInBytes;
    chunk.durationInfoInMilliseconds = durationInfoInMilliseconds;
    chunk.accessRestricted = accessRestricted || false;

    if (isWorking) {
      const isIncorrecto = await checkFeedCompleteness(chunk.feedUrl);
      chunk.isCorrecto = !isIncorrecto;
      runningFlows.push(chunk);
    } else {
      chunk.errorMessage = errorMessage;
      errorFeeds.push(chunk);
    }
  });

  writeFileData("runningFlow.json", runningFlows);
  writeFileData("errorFeeds.json", errorFeeds);
}
