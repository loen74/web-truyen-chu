require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('./db');
// Thêm thư viện validation
const { body, validationResult } = require('express-validator');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // Phục vụ file tĩnh (index.html, CSS, JS)

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware xác thực token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); // Không có token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Token không hợp lệ hoặc hết hạn
        req.user = user;
        next();
    });
};

// Middleware kiểm tra quyền tác giả/admin
const authorizeAuthor = async (req, res, next) => {
    try {
        const { novelId } = req.params;
        const result = await pool.query('SELECT user_id FROM novels WHERE id = $1', [novelId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Truyện không tồn tại.' });
        }

        const novelOwnerId = result.rows[0].user_id;

        // Chỉ tác giả (owner) hoặc admin mới được phép
        if (novelOwnerId === req.user.id || req.user.role === 'admin') {
            next();
        } else {
            res.sendStatus(403); // Không có quyền
        }

    } catch (error) {
        console.error('Lỗi kiểm tra quyền:', error);
        res.status(500).json({ message: 'Lỗi server khi kiểm tra quyền.' });
    }
};

// =======================================================
// ROUTES VỀ AUTHENTICATION
// =======================================================

// Đăng ký (ĐÃ THÊM VALIDATION)
app.post('/api/register', [
    // Validation Rules
    body('email').isEmail().withMessage('Email không hợp lệ'),
    body('password').isLength({ min: 6 }).withMessage('Mật khẩu phải có ít nhất 6 ký tự'),
    body('name').trim().isLength({ min: 1 }).withMessage('Tên không được để trống')
], async (req, res) => {
    // Kiểm tra kết quả validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'Email đã tồn tại' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Mặc định là 'user', trừ khi bạn muốn tạo admin
        await pool.query('INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)', [email, hashedPassword, name, 'user']);

        res.status(201).json({ message: 'Đăng ký thành công' });
    } catch (error) {
        console.error('Lỗi đăng ký:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server.' });
    }
});

// Đăng nhập
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const userResult = await pool.query('SELECT id, password, name, role FROM users WHERE email = $1', [email]);

        if (userResult.rows.length === 0) {
            return res.status(400).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        const user = userResult.rows[0];

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        // Tạo JWT Token
        const token = jwt.sign({ id: user.id, name: user.name, email: email, role: user.role }, JWT_SECRET, { expiresIn: '1h' });

        res.json({ token, user: { id: user.id, name: user.name, email: email, role: user.role } });
    } catch (error) {
        console.error('Lỗi đăng nhập:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server.' });
    }
});

// =======================================================
// ROUTES VỀ TRUYỆN (NOVELS)
// =======================================================

// Lấy tất cả truyện
app.get('/api/novels', async (req, res) => {
    try {
        // Có thể thêm ORDER BY created_at DESC để truyện mới nhất lên đầu
        const result = await pool.query('SELECT novels.id, novels.title, users.name as author_name, novels.description FROM novels JOIN users ON novels.user_id = users.id');
        res.json(result.rows);
    } catch (error) {
        console.error('Lỗi lấy truyện:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Lấy chi tiết truyện
app.get('/api/novels/:novelId', async (req, res) => {
    try {
        const { novelId } = req.params;
        const result = await pool.query('SELECT novels.id, novels.title, users.name as author_name, novels.description, novels.user_id FROM novels JOIN users ON novels.user_id = users.id WHERE novels.id = $1', [novelId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Truyện không tồn tại' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Lỗi lấy chi tiết truyện:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Thêm truyện mới (Cần xác thực)
app.post('/api/novels', authenticateToken, async (req, res) => {
    const { title, description } = req.body;
    const userId = req.user.id; // Lấy ID của người dùng từ token

    try {
        const result = await pool.query('INSERT INTO novels (title, description, user_id) VALUES ($1, $2, $3) RETURNING id', [title, description, userId]);
        res.status(201).json({ message: 'Truyện đã được thêm thành công', novelId: result.rows[0].id });
    } catch (error) {
        console.error('Lỗi thêm truyện:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Sửa truyện (Cần xác thực và quyền tác giả)
app.put('/api/novels/:novelId', authenticateToken, authorizeAuthor, async (req, res) => {
    const { novelId } = req.params;
    const { title, description } = req.body;

    try {
        await pool.query('UPDATE novels SET title = $1, description = $2 WHERE id = $3', [title, description, novelId]);
        res.json({ message: 'Truyện đã được cập nhật.' });
    } catch (error) {
        console.error('Lỗi sửa truyện:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Xóa truyện (Cần xác thực và quyền tác giả)
app.delete('/api/novels/:novelId', authenticateToken, authorizeAuthor, async (req, res) => {
    const { novelId } = req.params;

    try {
        // CASCADE trong schema sẽ xóa các chapters liên quan
        await pool.query('DELETE FROM novels WHERE id = $1', [novelId]);
        res.json({ message: 'Truyện và tất cả chương đã bị xóa.' });
    } catch (error) {
        console.error('Lỗi xóa truyện:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// =======================================================
// ROUTES VỀ CHƯƠNG (CHAPTERS)
// =======================================================

// Lấy danh sách chương của một truyện
app.get('/api/novels/:novelId/chapters', async (req, res) => {
    try {
        const { novelId } = req.params;
        // Sắp xếp theo thứ tự (id) tăng dần
        const result = await pool.query('SELECT id, title FROM chapters WHERE novel_id = $1 ORDER BY id ASC', [novelId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Lỗi lấy chương:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Lấy chi tiết một chương
app.get('/api/chapters/:chapterId', async (req, res) => {
    try {
        const { chapterId } = req.params;
        const result = await pool.query('SELECT id, novel_id, title, content FROM chapters WHERE id = $1', [chapterId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Chương không tồn tại' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Lỗi lấy chi tiết chương:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Thêm chương mới (Cần xác thực và quyền tác giả)
app.post('/api/novels/:novelId/chapters', authenticateToken, authorizeAuthor, async (req, res) => {
    const { novelId } = req.params;
    const { title, content } = req.body;

    try {
        const result = await pool.query('INSERT INTO chapters (novel_id, title, content) VALUES ($1, $2, $3) RETURNING id', [novelId, title, content]);
        res.status(201).json({ message: 'Chương đã được thêm thành công', chapterId: result.rows[0].id });
    } catch (error) {
        console.error('Lỗi thêm chương:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Sửa chương (Cần xác thực và quyền tác giả)
app.put('/api/chapters/:chapterId', authenticateToken, async (req, res) => {
    const { chapterId } = req.params;
    const { title, content } = req.body;

    try {
        // Lấy novel_id của chương
        const chapterResult = await pool.query('SELECT novel_id FROM chapters WHERE id = $1', [chapterId]);
        if (chapterResult.rows.length === 0) {
            return res.status(404).json({ message: 'Chương không tồn tại.' });
        }
        const novelId = chapterResult.rows[0].novel_id;

        // Kiểm tra quyền tác giả/admin của truyện này
        const novelResult = await pool.query('SELECT user_id FROM novels WHERE id = $1', [novelId]);
        const novelOwnerId = novelResult.rows[0].user_id;

        if (novelOwnerId !== req.user.id && req.user.role !== 'admin') {
            return res.sendStatus(403); // Không có quyền
        }
        
        // Cập nhật chương
        await pool.query('UPDATE chapters SET title = $1, content = $2 WHERE id = $3', [title, content, chapterId]);
        res.json({ message: 'Chương đã được cập nhật.' });
    } catch (error) {
        console.error('Lỗi sửa chương:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// Xóa chương (Cần xác thực và quyền tác giả)
app.delete('/api/chapters/:chapterId', authenticateToken, async (req, res) => {
    const { chapterId } = req.params;

    try {
        // Kiểm tra quyền tác giả/admin tương tự như PUT
        const chapterResult = await pool.query('SELECT novel_id FROM chapters WHERE id = $1', [chapterId]);
        if (chapterResult.rows.length === 0) {
            return res.status(404).json({ message: 'Chương không tồn tại.' });
        }
        const novelId = chapterResult.rows[0].novel_id;

        const novelResult = await pool.query('SELECT user_id FROM novels WHERE id = $1', [novelId]);
        const novelOwnerId = novelResult.rows[0].user_id;

        if (novelOwnerId !== req.user.id && req.user.role !== 'admin') {
            return res.sendStatus(403); // Không có quyền
        }

        await pool.query('DELETE FROM chapters WHERE id = $1', [chapterId]);
        res.json({ message: 'Chương đã bị xóa.' });
    } catch (error) {
        console.error('Lỗi xóa chương:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
});


// Khởi động Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    console.log('📚 Web truyện: http://localhost:3000');
    console.log('💾 Database: PostgreSQL (Neon)');
});