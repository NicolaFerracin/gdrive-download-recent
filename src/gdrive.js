const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];
const TOKEN_PATH = "token.json";

class GDriveClient {
  constructor() {
    this.auth = null;
    this.drive = null;
    this.rootFolderID = "0AFNFrTMgQOutUk9PVA";
  }

  init(cb) {
    fs.readFile("credentials.json", (err, content) => {
      if (err) return console.log("Error loading client secret file:", err);
      this.authorize(JSON.parse(content.toString()), cb);
    });
  }

  authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } =
      credentials?.installed || {};
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) return this.getAccessToken(oAuth2Client, callback);
      oAuth2Client.setCredentials(JSON.parse(token.toString()));
      this.auth = oAuth2Client;
      callback();
    });
  }

  getAccessToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });
    console.log("Authorize this app by visiting this url:", authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Enter the code from that page here: ", (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err || !token)
          return console.error("Error retrieving access token", err);
        oAuth2Client.setCredentials(token);
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
          if (err) return console.error(err);
          console.log("Token stored to", TOKEN_PATH);
        });
        this.auth = oAuth2Client;
        callback();
      });
    });
  }

  async getFilePath(fileId) {
    const getFullPath = async (id, pathList) => {
      if (id === this.rootFolderID) {
        pathList.reverse();
        pathList.pop();
        return "My Drive/" + pathList.join("/");
      }

      const res = await this.drive.files.get({
        fileId: id,
        fields: "id, name, parents",
      });

      if (res) {
        pathList.push(res?.data?.name);
        return getFullPath(res.data.parents[0], pathList);
      }
    };

    return getFullPath(fileId, []);
  }

  async ensurePath(drivePath) {
    const destPath = path.join(__dirname, "../", drivePath);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    return destPath;
  }

  async doDownload(file, destPath) {
    this.drive.files
      .get({ fileId: file.id, alt: "media" }, { responseType: "stream" })
      .then((res) => {
        return new Promise((resolve, reject) => {
          const filePath = `${destPath}/${file.name}`;
          const dest = fs.createWriteStream(filePath);
          res.data
            .on("end", () => {
              resolve(filePath);
            })
            .on("error", (err) => {
              reject(err);
            })
            .pipe(dest);
        });
      });
  }

  async doExport(file, destPath) {
    const mimeTypeMap = {
      "application/vnd.google-apps.spreadsheet":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const extensionMap = {
      "application/vnd.google-apps.spreadsheet": "xlsx",
    };
    const extension = extensionMap[file.mimeType]
      ? `.${extensionMap[file.mimeType]}`
      : ".pdf";
    const filePath = `${destPath}/${file.name}${extension}`;
    const dest = fs.createWriteStream(filePath);
    const res = await this.drive.files.export(
      {
        fileId: file.id,
        mimeType: mimeTypeMap[file.mimeType] || "application/pdf",
      },
      { responseType: "stream" }
    );
    await new Promise((resolve, reject) => {
      res.data
        .on("error", reject)
        .pipe(dest)
        .on("error", reject)
        .on("finish", resolve);
    });
  }

  async downloadFile(file) {
    const drivePath = await this.getFilePath(file.id);
    const destPath = await this.ensurePath(drivePath);
    console.log("Starting download for", file.name, "at location", destPath);
    if (file.mimeType.startsWith("application/vnd.google-apps")) {
      await this.doExport(file, destPath);
    } else {
      await this.doDownload(file, destPath);
    }
  }

  async downloadRecentFiles(afterDate) {
    this.drive = google.drive({ version: "v3", auth: this.auth });

    const isoDate = new Date(afterDate).toISOString();
    const res = await this.drive.files.list({
      q: `'me' in owners and trashed = false and (createdTime > '${isoDate}' or modifiedTime > '${isoDate}')`,
    });

    const files = res?.data?.files;
    await Promise.all(
      files.map(async (file) => {
        this.downloadFile(file);
      })
    );
  }
}

module.exports = GDriveClient;
