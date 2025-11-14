const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generate } = require('./index');

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.post('/generate', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('missing image');
  const thickness = parseFloat(req.body.thickness_mm) || 2.0;
  const width_mm = req.body.width_mm ? parseFloat(req.body.width_mm) : undefined;
  const height_mm = req.body.height_mm ? parseFloat(req.body.height_mm) : undefined;
  const threshold = req.body.threshold ? parseInt(req.body.threshold, 10) : 128;
  const max_px = req.body.max_px ? parseInt(req.body.max_px, 10) : undefined;
  const target_mb = req.body.target_mb ? parseFloat(req.body.target_mb) : undefined;

    const outName = 'out_' + Date.now() + '.stl';
    const outPath = path.join(__dirname, outName);
  const result = await generate({ buffer: req.file.buffer, output: outPath, thickness, width_mm, height_mm, threshold, max_px, target_size_mb: target_mb });
    res.download(outPath, 'model.stl', err => {
      // cleanup
      try { fs.unlinkSync(outPath); } catch (e) {}
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(String(err));
  }
});

app.listen(PORT, () => {
  console.log('Server running http://localhost:' + PORT);
});
