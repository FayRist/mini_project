const fsPromises = require('fs').promises;
var fs = require('graceful-fs');
const path = require('path');
const archiver = require('archiver');
const { Sequelize, DataTypes, Op } = require('sequelize');
const PDFDocument = require('pdfkit');
const limit = require('promise-limit')(6000);

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
console.time('Execution Time');

// ฟังก์ชั่นสำหรับอ่านไฟล์และสร้างไฟล์ตามแต่ละคำศัพท์
async function readFileFaster() {
  try {
    const data = await fsPromises.readFile(inputFilePath, 'utf8');
    const words = data.split('\n').filter(word => word.trim() !== '');
    await ensureDirectoryExistence(directoryPath);
    // สร้างไฟล์ทีละ 6000
    const promises = words.map(word => 
      limit(() => convertTextToFileFaster(word.toLowerCase(), directoryPath))
    );
    
    await Promise.all(promises);
    // await Promise.all(words.map(word => convertTextToFileFaster(word.toLowerCase(), directoryPath)));

    console.log('\nAll files have been created successfully.');

    await zipDirectories(directoryPath, zipFolderPath);
    console.log('\nAll files have been Zip successfully.');
        
    await generateReports(directoryPath, reportFolderPath);
    console.log('\nAll files Reports have been created successfully.');

    await manageDatabase();
    await exportToPDF().then(() => {
      console.log('\nExecution Time V.1 Fast');

      // จบการนับเวลาและแสดงผลในคอนโซล
      console.timeEnd('Execution Time');
    })
    .catch(err => {
      console.error('Error in processing', err);
      console.log('\nExecution Time V.1 Fast');
      console.timeEnd('Execution Time');
    });
    console.log('\n files Manage Database And Export PDF have been created successfully.');

  } catch (err) {
    console.error('Error reading file', err);
  }
}

// ฟังก์ชั่นสำหรับสร้างไดเรกทอรีหากยังไม่มี
async function ensureDirectoryExistence(dirPath) {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

// ฟังก์ชั่นสำหรับสร้างไฟล์
async function convertTextToFileFaster(word, directoryPath) {

  const trimmedWord = word.trim();
  if (trimmedWord.length < 2) {
    return;
  }

  const firstLevelDir = path.join(directoryPath, trimmedWord[0].toUpperCase());
  const secondLevelDir = path.join(firstLevelDir, trimmedWord[1].toUpperCase());
  const fileName = `${trimmedWord}.txt`;
  const content = (trimmedWord + '\n').repeat(100);
  const filePath = path.join(secondLevelDir, fileName);

  try {
    await ensureDirectoryExistence(secondLevelDir);
    await fsPromises.writeFile(filePath, content);
  } catch (err) {
    console.error(`Error writing to file ${fileName}`, err);
  }
}

// ฟังก์ชั่นสำหรับ ZIP โฟลเดอร์
async function zipDirectories(sourceDir, targetDir) {
  try {
    const firstLevelDirs = await fsPromises.readdir(sourceDir, { withFileTypes: true });
    await ensureDirectoryExistence(targetDir);

    await Promise.all(firstLevelDirs.map(dir => {
      if (dir.isDirectory()) {
        const sourcePath = path.join(sourceDir, dir.name);
        const zipPath = path.join(targetDir, `${dir.name}.zip`);
        return zipDirectory(sourcePath, zipPath);
      }
    }));
  } catch (err) {
    console.error('Error zipping directories', err);
  }
}

// ฟังก์ชั่นสำหรับ ZIP โฟลเดอร์เดี่ยว
function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // ตั้งค่า compression level
    });

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));
    archive.pipe(output);
    archive.directory(sourceDir, false).finalize();
  });
}

// ฟังก์ชั่นสำหรับสร้างรายงานขนาดโฟลเดอร์และลิสต์ของไฟล์
async function generateReports(sourceDir, targetDir) {
  try {
    const firstLevelDirs = await fsPromises.readdir(sourceDir, { withFileTypes: true });
    await ensureDirectoryExistence(targetDir);

    await Promise.all(firstLevelDirs.map(dir => {
      if (dir.isDirectory()) {
        const dirPath = path.join(sourceDir, dir.name);
        const zipPath = path.join(zipFolderPath, `${dir.name}.zip`);
        const reportPath = path.join(targetDir, `Report${dir.name}.txt`);
        return createReportFile(dirPath, reportPath, zipPath);
      }
    }));
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
      totalSize += await getFolderSize(filePath);
    } else {
      const stats = await fs.promises.stat(filePath);
      totalSize += stats.size;
    }
  }

  return totalSize;
}

// ฟังก์ชั่นในการจัดการกับฐานข้อมูล
async function manageDatabase() {
  await sequelize.sync({ force: true });

  const dictionary = fs.readFileSync(inputFilePath, 'utf-8');
  const words = dictionary.split('\n').filter(word => word.length > 0).map(word => ({ word }));

  await Word.bulkCreate(words);

  const longWordsCount = await Word.count({
    where: sequelize.where(sequelize.fn('length', sequelize.col('word')), '>', 5)
  });

  const repeatedCharWordsCount = (await Word.findAll()).filter(word => /(.)\1/.test(word.word)).length;

  const sameStartEndCount = await Word.count({
    where: sequelize.where(
      sequelize.fn('SUBSTR', sequelize.col('word'), 1, 1),
      sequelize.fn('SUBSTR', sequelize.col('word'), -1, 1)
    )
  });

  await sequelize.query(`UPDATE Words SET word = UPPER(SUBSTR(word, 1, 1)) || SUBSTR(word, 2)`);

  console.log(`7.1 มีคำกี่คำที่มีความยาว > 5 character : ${longWordsCount} คำ`);
  console.log(`7.2 มีคำกี่คำที่มีตัวอักษรซ้ำในคำมากกว่าหรือเท่ากับ 2 character: ${repeatedCharWordsCount} คำ`);
  console.log(`7.3 มีคำกี่คำที่ขึ้นต้นและลงท้ายด้วยตัวอักษรเดียวกัน : ${sameStartEndCount} คำ`);
  console.log('อัพเดตคำเสร็จเรียบร้อย');
}

// ฟังก์ชั่นในการ export ข้อมูลเป็น PDF
async function exportToPDF() {
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
}

// ฟังก์ชั่นสำหรับสร้างรายงานขนาดของโฟลเดอร์
async function createReportFile(dirPath, reportPath, zipFilePath) {
  try {
    const folderSizeBefore = await getFolderSize(dirPath);
    const zipSize = getFileSize(zipFilePath);
    const percentageReduction = (((folderSizeBefore / 1024) - (zipSize / 1024)) / (folderSizeBefore / 1024)) * 100;
    const reportContent = `
      Report for directory: ${path.basename(dirPath)}

      Size before zip: ${(folderSizeBefore / 1024).toFixed(4)} KB
      Size after zip: ${(zipSize / 1024).toFixed(4)} KB
      Compression reduction: ${percentageReduction.toFixed(2)}%
    `;

    await fs.promises.writeFile(reportPath, reportContent);
  } catch (err) {
    console.error(`Error creating report for ${dirPath}`, err);
  }
}

const getFileSize = filePath => {
  const stats = fs.statSync(filePath);
  return stats.size;
};

module.exports = { readFileFaster, convertTextToFileFaster };
