# Sổ Sticker

Game riêng, tách từ Peel Pixel: bóc sticker vào khay đúng loại, đủ bộ ba thì sticker bay lên dán vào cuốn sổ sưu tầm. Dán kín trang sổ là thắng.

Chơi: mở `dist/so-sticker.html` (một file, gửi đi là chơi được), hoặc `python -m http.server` trong thư mục này rồi mở `index.html`.
Build: `node tools/build.js`. Test: `node tools/test-orders.js`, `node tools/test-pixel.js`.

Code tách hẳn khỏi `../PeelOff`: sửa ở đây không ảnh hưởng Peel Pixel và ngược lại. Tiến độ lưu riêng (`so-sticker-v1`).
Level lấy từ ảnh trong `levels-src/` (sinh `js/image-levels.js` bằng `python tools/img2levels.py`).
