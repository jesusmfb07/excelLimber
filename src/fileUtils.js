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
async function writeFileData(filename, data) {
  try {
    // Convierte los datos a formato JSON
    const jsonData = JSON.stringify(data, null, 2);
    console.log('Data: ' + data);
    console.log('filename: '+ filename);
    // Escribe los datos en el archivo especificado
    fs.writeFileSync(filename, jsonData);
    
    console.log(`Data successfully written to ${filename}`);
  } catch (error) {
    console.error(`Error writing data to ${filename}:`, error);
  }
}

export { writeResultsToFile, writeFileData};