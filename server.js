require('dotenv').config();
// server.js - Backend với PostgreSQL
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const JWT_SECRET = 'truyen-chu-secret-key-2024';

// Middleware xác thực
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

// ===== AUTH API =====

// Đăng ký
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name, role',
      [email, hashedPassword, name]
    );
    
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Đăng nhập
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }
    
    const user = result.rows[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ 
      token, 
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Lấy thông tin user hiện tại
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User không tìm thấy' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// ===== NOVELS API =====

// Lấy tất cả truyện
app.get('/api/novels', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, 
             (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id) as chapter_count
      FROM novels n
      ORDER BY n.created_at DESC
    `);
    
    const novels = result.rows.map(novel => ({
      id: novel.id,
      title: novel.title,
      author: novel.author,
      description: novel.description,
      coverImage: novel.cover_image,
      authorId: novel.author_id,
      createdAt: novel.created_at,
      chapterCount: parseInt(novel.chapter_count)
    }));
    
    res.json(novels);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Lấy chi tiết 1 truyện
app.get('/api/novels/:id', async (req, res) => {
  try {
    const novelResult = await pool.query('SELECT * FROM novels WHERE id = $1', [req.params.id]);
    
    if (novelResult.rows.length === 0) {
      return res.status(404).json({ message: 'Truyện không tìm thấy' });
    }
    
    const novel = novelResult.rows[0];
    
    const chaptersResult = await pool.query(
      'SELECT * FROM chapters WHERE novel_id = $1 ORDER BY chapter_number ASC',
      [req.params.id]
    );
    
    res.json({
      id: novel.id,
      title: novel.title,
      author: novel.author,
      description: novel.description,
      coverImage: novel.cover_image,
      authorId: novel.author_id,
      createdAt: novel.created_at,
      chapters: chaptersResult.rows.map(c => ({
        id: c.id,
        novelId: c.novel_id,
        chapterNumber: c.chapter_number,
        title: c.title,
        content: c.content,
        createdAt: c.created_at
      }))
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Tạo truyện mới
app.post('/api/novels', auth, async (req, res) => {
  try {
    const { title, author, description, coverImage } = req.body;
    
    const result = await pool.query(
      `INSERT INTO novels (title, author, description, cover_image, author_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, author, description, coverImage || 'https://via.placeholder.com/300x400?text=Novel', req.userId]
    );
    
    const novel = result.rows[0];
    res.status(201).json({
      id: novel.id,
      title: novel.title,
      author: novel.author,
      description: novel.description,
      coverImage: novel.cover_image,
      authorId: novel.author_id,
      createdAt: novel.created_at
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Sửa truyện
app.put('/api/novels/:id', auth, async (req, res) => {
  try {
    const checkResult = await pool.query('SELECT * FROM novels WHERE id = $1', [req.params.id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Truyện không tìm thấy' });
    }
    
    if (checkResult.rows[0].author_id !== req.userId) {
      return res.status(403).json({ message: 'Bạn không có quyền sửa truyện này' });
    }
    
    const { title, author, description, coverImage } = req.body;
    
    const result = await pool.query(
      `UPDATE novels 
       SET title = $1, author = $2, description = $3, cover_image = $4
       WHERE id = $5 RETURNING *`,
      [title, author, description, coverImage, req.params.id]
    );
    
    const novel = result.rows[0];
    res.json({
      id: novel.id,
      title: novel.title,
      author: novel.author,
      description: novel.description,
      coverImage: novel.cover_image,
      authorId: novel.author_id,
      createdAt: novel.created_at
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Xóa truyện
app.delete('/api/novels/:id', auth, async (req, res) => {
  try {
    const checkResult = await pool.query('SELECT * FROM novels WHERE id = $1', [req.params.id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Truyện không tìm thấy' });
    }
    
    if (checkResult.rows[0].author_id !== req.userId) {
      return res.status(403).json({ message: 'Bạn không có quyền xóa truyện này' });
    }
    
    await pool.query('DELETE FROM novels WHERE id = $1', [req.params.id]);
    
    res.json({ message: 'Đã xóa truyện' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// ===== CHAPTERS API =====

// Lấy chi tiết 1 chương
app.get('/api/chapters/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chapters WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Chương không tìm thấy' });
    }
    
    const chapter = result.rows[0];
    res.json({
      id: chapter.id,
      novelId: chapter.novel_id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      content: chapter.content,
      createdAt: chapter.created_at
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Tạo chương mới
app.post('/api/novels/:novelId/chapters', auth, async (req, res) => {
  try {
    const novelResult = await pool.query('SELECT * FROM novels WHERE id = $1', [req.params.novelId]);
    
    if (novelResult.rows.length === 0) {
      return res.status(404).json({ message: 'Truyện không tìm thấy' });
    }
    
    if (novelResult.rows[0].author_id !== req.userId) {
      return res.status(403).json({ message: 'Bạn không có quyền thêm chương cho truyện này' });
    }
    
    const { title, content } = req.body;
    
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM chapters WHERE novel_id = $1',
      [req.params.novelId]
    );
    const chapterNumber = parseInt(countResult.rows[0].count) + 1;
    
    const result = await pool.query(
      `INSERT INTO chapters (novel_id, chapter_number, title, content) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.novelId, chapterNumber, title, content]
    );
    
    const chapter = result.rows[0];
    res.status(201).json({
      id: chapter.id,
      novelId: chapter.novel_id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      content: chapter.content,
      createdAt: chapter.created_at
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Sửa chương
app.put('/api/chapters/:id', auth, async (req, res) => {
  try {
    const chapterResult = await pool.query('SELECT * FROM chapters WHERE id = $1', [req.params.id]);
    
    if (chapterResult.rows.length === 0) {
      return res.status(404).json({ message: 'Chương không tìm thấy' });
    }
    
    const chapter = chapterResult.rows[0];
    
    const novelResult = await pool.query('SELECT * FROM novels WHERE id = $1', [chapter.novel_id]);
    if (novelResult.rows[0].author_id !== req.userId) {
      return res.status(403).json({ message: 'Bạn không có quyền sửa chương này' });
    }
    
    const { title, content } = req.body;
    
    const result = await pool.query(
      `UPDATE chapters SET title = $1, content = $2 WHERE id = $3 RETURNING *`,
      [title, content, req.params.id]
    );
    
    const updatedChapter = result.rows[0];
    res.json({
      id: updatedChapter.id,
      novelId: updatedChapter.novel_id,
      chapterNumber: updatedChapter.chapter_number,
      title: updatedChapter.title,
      content: updatedChapter.content,
      createdAt: updatedChapter.created_at
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Xóa chương
app.delete('/api/chapters/:id', auth, async (req, res) => {
  try {
    const chapterResult = await pool.query('SELECT * FROM chapters WHERE id = $1', [req.params.id]);
    
    if (chapterResult.rows.length === 0) {
      return res.status(404).json({ message: 'Chương không tìm thấy' });
    }
    
    const chapter = chapterResult.rows[0];
    
    const novelResult = await pool.query('SELECT * FROM novels WHERE id = $1', [chapter.novel_id]);
    if (novelResult.rows[0].author_id !== req.userId) {
      return res.status(403).json({ message: 'Bạn không có quyền xóa chương này' });
    }
    
    await pool.query('DELETE FROM chapters WHERE id = $1', [req.params.id]);
    
    res.json({ message: 'Đã xóa chương' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`📚 Web truyện: http://localhost:${PORT}`);
  console.log(`💾 Database: PostgreSQL (Neon)`);
  console.log(`👤 Tài khoản test: admin@truyen.com / 123456`);
});