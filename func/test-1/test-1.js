const express = require('express');
const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { Sequelize, DataTypes, Op } = require('sequelize');
const PDFDocument = require('pdfkit');

const directoryPath = '/test-project-Node/func/test-1/fileExport';
const inputFilePath = '/test-project-Node/public/data/20k-word.txt';
const zipFolderPath = '/test-project-Node/func/test-1/zipFile';
const reportFolderPath = '/test-project-Node/func/test-1/reportFile';
const pdfFolderPath = '/test-project-Node/func/test-1/pdfFile';

// ตั้งค่าโฟลเดอร์ฐานข้อมูล
const databaseDir = path.join(__dirname, 'database');
if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}
// ตั้งค่า Sequelize สำหรับ SQLite โดยปิดการแสดงผล query logs
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(databaseDir, 'dictionary.sqlite'),
  logging: false // ปิดการแสดงผล query logs
});
// กำหนด model สำหรับคำศัพท์
const Word = sequelize.define('Word', {
  word: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
}, {
  timestamps: false
});

// ฟังก์ชั่นสำหรับอ่านไฟล์และสร้างไฟล์ตามแต่ละคำศัพท์
async function readFile() {
  if (!inputFilePath || !directoryPath) {
    console.error('Input file path or directory path is not defined.');
    process.exit(1);
  }

  try {
    const data = await fsPromises.readFile(inputFilePath, 'utf8');
    // แยกคำศัพท์ออกเป็นรายการ
    const words = data.split('\n').filter(word => word.trim() !== '');

    // สร้างไฟล์ตามแต่ละคำศัพท์ทีละชุด
    await words.reduce((promise, word) => {
      const wordConverter = word ? word.toLowerCase() : word;
      return promise.then(async () => await convertTextToFile(wordConverter, directoryPath));
    }, Promise.resolve());

    // พิมพ์ข้อความ success เมื่อการทำงานทั้งหมดเสร็จสิ้น
    console.log('\nAll files have been created successfully.');

    // ZIP โฟลเดอร์ level 1
    await zipDirectories(directoryPath, zipFolderPath);
    console.log('\nAll files have been Zip successfully.');
        
    // สร้างรายงานขนาดโฟลเดอร์และลิสต์ของไฟล์
    await generateReports(directoryPath, reportFolderPath);
    console.log('\nAll files Reports have been created successfully.');

    // สร้างไฟล์
    await manageDatabase();
    await exportToPDF();
    console.log('\n files Manage Database have been created successfully.');

  } catch (err) {
    console.error('Error reading file', err);
  }
}

// ฟังก์ชั่นสำหรับสร้างไดเรกทอรีหากยังไม่มี
async function ensureDirectoryExistence(dirPath) {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
    process.stdout.write(`Directory created: ${dirPath}\r`);
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

// ฟังก์ชั่นสำหรับสร้างไฟล์
async function convertTextToFile(word, directoryPath) {
  const trimmedWord = word.trim();
  if (trimmedWord.length < 2) {
    // console.error(`Word ${word} is too short to categorize.`);
    return;
  }

  const firstLevelDir = path.join(directoryPath, trimmedWord[0].toUpperCase());
  const secondLevelDir = path.join(firstLevelDir, trimmedWord[1].toUpperCase());
  const fileName = `${trimmedWord}.txt`;
  const content = (trimmedWord + '\n').repeat(100);
  const filePath = path.join(secondLevelDir, fileName);

  try {
    // สร้างไดเรกทอรีหากยังไม่มี
    await ensureDirectoryExistence(secondLevelDir);
    // เขียนไฟล์
    await fsPromises.writeFile(filePath, content);
    process.stdout.write(`File ${fileName} has been created successfully at ${secondLevelDir}.\r`);
  } catch (err) {
    console.error(`Error writing to file ${fileName}`, err);
  }
}

// ฟังก์ชั่นสำหรับ ZIP โฟลเดอร์
async function zipDirectories(sourceDir, targetDir) {
  try {
    const firstLevelDirs = await fsPromises.readdir(sourceDir, { withFileTypes: true });
    await ensureDirectoryExistence(targetDir);

    for (const dir of firstLevelDirs) {
      if (dir.isDirectory()) {
        const sourcePath = path.join(sourceDir, dir.name);
        const zipPath = path.join(targetDir, `${dir.name}.zip`);
        await zipDirectory(sourcePath, zipPath);
        process.stdout.write(`Zipped ${dir.name} to ${zipPath}\r`);
      }
    }
  } catch (err) {
    console.error('Error zipping directories', err);
  }
}

// ฟังก์ชั่นสำหรับ ZIP โฟลเดอร์เดี่ยว
function zipDirectory(sourceDir, outPath) {
  return new Promise(async (resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // ตั้งค่า compression level
    });

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));
    archive.pipe(output);
    await archive.directory(sourceDir, false);
    await archive.finalize();
  });
}

// ฟังก์ชั่นสำหรับสร้างรายงานขนาดโฟลเดอร์และลิสต์ของไฟล์
async function generateReports(sourceDir, targetDir) {
  try {
    const firstLevelDirs = await fsPromises.readdir(sourceDir, { withFileTypes: true });
    await ensureDirectoryExistence(targetDir);

    for (const dir of firstLevelDirs) {
      if (dir.isDirectory()) {
        const dirPath = path.join(sourceDir, dir.name);
        const zipPath = path.join(zipFolderPath, `${dir.name}.zip`);
        const reportPath = path.join(targetDir, `Report${dir.name}.txt`);
        await createReportFile(dirPath, reportPath, zipPath);
      }
    }
  } catch (err) {
    console.error('Error generating reports', err);
  }
}

// ฟังก์ชั่นสำหรับคำนวณขนาดของไฟล์
async function getFolderSize(dirPath) {
  let totalSize = 0;

  const files = await fs.promises.readdir(dirPath, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);

    if (file.isDirectory()) {
      // ถ้าเป็นโฟลเดอร์ ให้คำนวณขนาดของโฟลเดอร์นั้น
      totalSize += await getFolderSize(filePath);
    } else {
      // ถ้าเป็นไฟล์ ให้คำนวณขนาดของไฟล์
      const stats = await fs.promises.stat(filePath);
      totalSize += stats.size;
    }
  }

  return totalSize;
}

// ฟังก์ชั่นในการจัดการกับฐานข้อมูล
async function  manageDatabase() {
  await sequelize.sync({ force: true });

  const dictionary = fs.readFileSync(inputFilePath, 'utf-8');
  const words = dictionary.split('\n').filter(word => word.length > 0).map(word => ({ word }));

  await Word.bulkCreate(words);

  // 7.1 คำที่มีความยาว > 5 ตัวอักษร
  const longWordsCount = await Word.count({
    where: sequelize.where(sequelize.fn('length', sequelize.col('word')), '>', 5)
  });

  // 7.2 คำที่มีตัวอักษรซ้ำมากกว่า 2 ตัวอักษร
  const repeatedCharWordsCount = (await Word.findAll()).filter(word => /(.)\1/.test(word.word)).length;

  // 7.3 คำที่ขึ้นต้นและลงท้ายด้วยตัวอักษรเดียวกัน
  const sameStartEndCount = await Word.count({
    where: sequelize.where(
      sequelize.fn('SUBSTR', sequelize.col('word'), 1, 1),
      sequelize.fn('SUBSTR', sequelize.col('word'), -1, 1)
    )
  });

  // 7.4 อัพเดตคำให้ตัวอักษรตัวแรกเป็นตัวพิมพ์ใหญ่
  await sequelize.query(`UPDATE Words SET word = UPPER(SUBSTR(word, 1, 1)) || SUBSTR(word, 2)`);

  console.log(`7.1 มีคำกี่คำที่มีความยาว > 5 character : ${longWordsCount} คำ`);
  console.log(`7.2 มีคำกี่คำที่มีตัวอักษรซ้ำในคำมากกว่าหรือเท่ากับ 2 character: ${repeatedCharWordsCount} คำ`);
  console.log(`7.3 มีคำกี่คำที่ขึ้นต้นและลงท้ายด้วยตัวอักษรเดียวกัน : ${sameStartEndCount} คำ`);
  console.log('อัพเดตคำเสร็จเรียบร้อย');
};

// ฟังก์ชั่นในการ export ข้อมูลเป็น PDF
async function  exportToPDF(){
  await ensureDirectoryExistence(pdfFolderPath);
  const words = await Word.findAll({ order: [['word', 'ASC']] });
  const pdfPath = path.join(pdfFolderPath, 'words.pdf');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  doc.pipe(fs.createWriteStream(pdfPath));

  doc.fontSize(12);
  words.forEach(word => {
    doc.text(word.word);
  });

  doc.end();
  console.log('Exported words to PDF:', pdfPath);
};


// ฟังก์ชั่นสำหรับสร้างรายงานขนาดของโฟลเดอร์
async function createReportFile(dirPath, reportPath, zipFilePath) {
  try {
    // คำนวณขนาดของโฟลเดอร์ก่อนการบีบอัด
    const folderSizeBefore = await getFolderSize(dirPath);
    
    // คำนวณขนาดของไฟล์ ZIP
    const zipSize = getFileSize(zipFilePath);
    // คำนวณเปอร์เซ็นต์การบีบอัด
    const percentageReduction = (((folderSizeBefore / 1024) - (zipSize / 1024)) / (folderSizeBefore / 1024)) * 100;
    // สร้างเนื้อหาของรายงาน
    const reportContent = `
      Report for directory: ${path.basename(dirPath)}

      Size before zip: ${(folderSizeBefore / 1024).toFixed(4)} KB
      Size after zip: ${(zipSize / 1024).toFixed(4)} KB
      Compression reduction: ${percentageReduction.toFixed(2)}%

    `;

    process.stdout.write(`Report created at ${reportPath}\r`);
    await fs.promises.writeFile(reportPath, reportContent);
  } catch (err) {
    console.error(`Error creating report for ${dirPath}`, err);
  }
}

const getFileSize = filePath => {
  const stats = fs.statSync(filePath);
  return stats.size;
};
module.exports = { readFile, convertTextToFile };
