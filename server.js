const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from root directory
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log('Server running http://localhost:' + PORT);
});
