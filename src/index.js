const GDriveClient = require("./gdrive");

const run = async () => {
  const GDrive = new GDriveClient();
  const cb = async () => {
    await GDrive.downloadRecentFiles(process.argv[2]);
    // GDrive.getFilePath();
  };
  GDrive.init(cb);
};

run();
