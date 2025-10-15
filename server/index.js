const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const OUT_DIR = path.join(__dirname, '..', 'public', 'videos');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// POST /upload
// expecting fields: mainImg (optional image), audio (audio file) OR video (input video)
app.post('/upload', upload.fields([
  { name: 'mainImg', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
  { name: 'video', maxCount: 1 }
]), async (req, res) => {
  try {
    const id = uuidv4();
    const outFile = path.join(OUT_DIR, `${id}.mp4`);
    const mainImg = req.files['mainImg'] ? req.files['mainImg'][0].path : null;
    const audioFile = req.files['audio'] ? req.files['audio'][0].path : null;
    const videoFile = req.files['video'] ? req.files['video'][0].path : null;

    if (!audioFile && !videoFile) {
      return res.status(400).json({ error: 'ต้องมี audio หรือ video อย่างน้อย 1 ไฟล์' });
    }

    // กรณีมี video มาแล้ว: ถ้าต้องการ เอาเสียง/ภาพจาก video แล้ว export ใหม่ -> ทำ re-encode
    if (videoFile && !audioFile) {
      // แค่อยากให้ไฟล์ถูกคอนเวิร์ทเป็น MP4 แบบมาตรฐาน
      ffmpeg(videoFile)
        .outputOptions('-c:v libx264', '-c:a aac', '-movflags +faststart')
        .on('end', () => {
          console.log('video converted ->', outFile);
          return res.json({ id, url: `/videos/${id}.mp4` });
        })
        .on('error', (err) => {
          console.error(err);
          return res.status(500).json({ error: 'ffmpeg error', detail: err.message });
        })
        .save(outFile);
      return;
    }

    // กรณีมี audio (+ optional image): สร้างวิดีโอจากรูปพื้นหลังสแตติก และใส่เสียง
    if (audioFile) {
      let command = ffmpeg();

      if (mainImg) {
        // ใช้ภาพนิ่งเป็นวิดีโอ loop (ภาพเดี่ยวแปลงเป็นวิดีโอความยาวเท่ากับ audio)
        command = ffmpeg()
          .input(mainImg)
          .loop(1)
          .input(audioFile)
          .outputOptions([
            '-c:v libx264',
            '-c:a aac',
            '-shortest',
            '-pix_fmt yuv420p',
            '-movflags +faststart'
          ]);
      } else {
        // ถ้าไม่มีภาพ ให้สร้างพื้นหลังสีดำ (ใช้ color source)
        // สร้างไฟล์วิดีโอสีดำชั่วคราวโดยใช้ ffmpeg filter (fluent-ffmpeg ใช้ complex filter)
        // ง่ายสุดคือใช้ ffmpeg command directly:
        const tmpOut = outFile; // final path
        // คำสั่ง: ffmpeg -f lavfi -i color=size=1280x720:duration=<dur>:color=black -i <audio> -c:v libx264 -c:a aac -shortest out.mp4
        ffmpeg()
          .input(`color=size=1280x720:duration=9999:color=black`)
          .inputOptions(['-f lavfi'])
          .input(audioFile)
          .outputOptions(['-c:v libx264', '-c:a aac', '-shortest', '-movflags +faststart', '-pix_fmt yuv420p'])
          .on('end', () => {
            console.log('black video with audio created ->', tmpOut);
            return res.json({ id, url: `/videos/${id}.mp4` });
          })
          .on('error', (err) => {
            console.error(err);
            return res.status(500).json({ error: 'ffmpeg error', detail: err.message });
          })
          .save(tmpOut);
        return;
      }

      // ถ้ามี mainImg และ audio
      command
        .on('end', () => {
          console.log('image + audio merged ->', outFile);
          return res.json({ id, url: `/videos/${id}.mp4` });
        })
        .on('error', (err) => {
          console.error(err);
          return res.status(500).json({ error: 'ffmpeg error', detail: err.message });
        })
        .save(outFile);

      return;
    }

    res.status(400).json({ error: 'invalid request' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error', detail: err.message });
  }
});

// serve uploaded video files under /videos/*
app.use('/videos', express.static(path.join(__dirname, '..', 'public', 'videos')));

// basic health
app.get('/ping', (req, res) => res.send('pong'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
