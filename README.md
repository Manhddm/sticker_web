# Sổ Sticker

Game riêng, tách từ Peel Pixel. Mỗi trang là một chuỗi nhiệm vụ sưu tầm; mỗi nhiệm vụ chiếm một trang đôi của sổ và cần một bộ sticker khác nhau theo chủ đề (vườn trái cây, tiệm bánh...).
Bóc đúng sticker nhiệm vụ đang cần thì nó bay thẳng lên sổ. Sticker chưa cần vào hộp chứa tạm; xong nhiệm vụ thì sổ lật sang nhiệm vụ mới và sticker trong hộp mà nhiệm vụ đó cần tự bay lên.
Xong nhiệm vụ cuối là thắng; hộp đầy mà không còn sticker nhiệm vụ cần để bóc là thua. Sao tính theo số sticker phải để vào hộp so với chuẩn của trang.

Chơi: mở `dist/so-sticker.html` (một file, gửi đi là chơi được), hoặc `python -m http.server` trong thư mục này rồi mở `index.html`.
Build: `node tools/build.js`. Test: `node tools/test-hunt.js` (mọi trang có lời giải, bot cẩn thận thắng đủ thường, in độ khó và chuẩn).

- `js/hunt.js`: luật (nhiệm vụ, hộp chứa tạm), cách chia sticker cho từng nhiệm vụ, bot, danh sách 12 trang.
- `js/book.js`: màn chơi: cuốn sổ và lật trang, hộp chứa tạm, trợ thủ, combo, màn chọn trang.
- `js/game.js`, `core.js`, `art.js`, `audio.js`, `i18n.js`: tờ sticker, hình vẽ sticker, âm thanh (bản riêng của game này).

Code tách hẳn khỏi `../PeelOff`. Tiến độ lưu riêng (`so-sticker-v2`).
