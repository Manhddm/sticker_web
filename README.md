# Sổ Sticker

Game riêng, tách từ Peel Pixel. Mỗi trang sổ là một nhiệm vụ: trang cần một bộ sticker khác nhau theo chủ đề (vườn trái cây, tiệm bánh...).
Bóc đúng sticker trang cần thì nó bay thẳng vào sổ. Sticker khác là đồ thừa: vào hộp đồ thừa, đủ 3 cái giống nhau thì tự dọn.
Dán kín trang là thắng; hộp đầy mà không bóc được gì nữa là thua. Sao tính theo số sticker thừa đã bóc so với chuẩn của trang.

Chơi: mở `dist/so-sticker.html` (một file, gửi đi là chơi được), hoặc `python -m http.server` trong thư mục này rồi mở `index.html`.
Build: `node tools/build.js`. Test: `node tools/test-hunt.js` (mọi trang có lời giải, bot cẩn thận thắng đủ thường, in độ khó và chuẩn).

- `js/hunt.js`: luật (hộp đồ thừa), cách chia sticker cần/thừa cho từng trang, bot, danh sách 12 trang.
- `js/book.js`: màn chơi: cuốn sổ, hộp đồ thừa, trợ thủ, combo, màn chọn trang.
- `js/game.js`, `core.js`, `art.js`, `audio.js`, `i18n.js`: tờ sticker, hình vẽ sticker, âm thanh (bản riêng của game này).

Code tách hẳn khỏi `../PeelOff`. Tiến độ lưu riêng (`so-sticker-v2`).
