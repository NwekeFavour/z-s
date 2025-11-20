const multer = require("multer")
const storage = multer.memoryStorage(); // We will upload directly to Cloudinary

const upload = multer({ storage });


module.exports = upload