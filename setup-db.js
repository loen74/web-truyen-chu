// setup-db.js - Tạo bảng trong PostgreSQL
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function setupDatabase() {
  try {
    console.log('🔧 Đang tạo database...');

    // Tạo bảng users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Đã tạo bảng users');

    // Tạo bảng novels
    await pool.query(`
      CREATE TABLE IF NOT EXISTS novels (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        description TEXT,
        cover_image VARCHAR(500),
        author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Đã tạo bảng novels');

    // Tạo bảng chapters
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chapters (
        id SERIAL PRIMARY KEY,
        novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
        chapter_number INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Đã tạo bảng chapters');

    // Thêm user admin mẫu
    const hashedPassword = bcrypt.hashSync('123456', 10);
    await pool.query(`
      INSERT INTO users (email, password, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['admin@truyen.com', hashedPassword, 'Admin', 'admin']);
    console.log('✅ Đã tạo user admin');

    // Lấy ID của admin
    const adminResult = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@truyen.com']);
    const adminId = adminResult.rows[0].id;

    // Thêm truyện mẫu
    const novelResult = await pool.query(`
      INSERT INTO novels (title, author, description, cover_image, author_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      'Tiên Nghịch',
      'Nhĩ Căn',
      'Thuận là phàm, nghịch là tiên, chỉ trong một niệm...',
      'https://via.placeholder.com/300x400?text=Tien+Nghich',
      adminId
    ]);

    if (novelResult.rows.length > 0) {
      const novelId = novelResult.rows[0].id;

      // Thêm chương mẫu
      await pool.query(`
        INSERT INTO chapters (novel_id, chapter_number, title, content)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [
        novelId,
        1,
        'Chương 1: Khởi Đầu',
        'Nội dung chương 1...\n\nĐây là nơi viết nội dung truyện.\n\nMỗi đoạn cách nhau bằng dòng trống.'
      ]);
      console.log('✅ Đã tạo truyện và chương mẫu');
    }

    console.log('\n🎉 Setup database thành công!');
    console.log('👤 Tài khoản test: admin@truyen.com / 123456\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi:', error.message);
    process.exit(1);
  }
}

setupDatabase();