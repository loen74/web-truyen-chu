const pool = require('./db');

async function resetDatabase() {
  try {
    console.log('🗑️  Đang xóa bảng cũ...');
    
    await pool.query('DROP TABLE IF EXISTS chapters CASCADE');
    await pool.query('DROP TABLE IF EXISTS novels CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('✅ Đã xóa bảng cũ');
    console.log('👉 Giờ chạy: node setup-db.js');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi:', err);
    process.exit(1);
  }
}

resetDatabase();