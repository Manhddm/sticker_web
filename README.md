# Sổ Sticker

Game riêng, tách từ Peel Pixel. Mỗi trang sổ là một nhiệm vụ: trang cần một bộ sticker theo chủ đề, có số lượng (ví dụ 2 dâu + 1 nho + 3 kiwi).
Mọi sticker bóc ra đều vào khay. Cả hai trang của trang đôi cùng mở: khay đủ bộ của trang nào thì cả bộ bay lên dán kín trang đó (trái hay phải trước đều được), xong cả hai thì lật sổ.
Dán kín mọi trang là thắng; khay đầy mà chưa đủ bộ nào là thua. Sao tính theo số sticker trang đang mở không cần mà vẫn bóc, so với chuẩn của màn.

Chơi: mở `dist/so-sticker.html` (một file, gửi đi là chơi được), hoặc `python -m http.server` trong thư mục này rồi mở `index.html`.
Build: `node tools/build.js`. Test: `node tools/test-hunt.js` (mọi trang có lời giải, bot cẩn thận thắng đủ thường, in độ khó và chuẩn).

- `js/hunt.js`: luật (khay, nhiệm vụ theo trang), cách chia sticker có lời giải mẫu, bot, màn truyện bãi biển.
- `js/book.js`: màn chơi: cuốn sổ và lật trang, khay, trợ thủ, combo, màn chọn màn.
- `js/game.js`, `core.js`, `art.js`, `audio.js`, `i18n.js`: tờ sticker, hình vẽ sticker, âm thanh (bản riêng của game này).

Code tách hẳn khỏi `../PeelOff`. Tiến độ lưu riêng (`so-sticker-v4`).

## Level

Hiện chỉ còn một màn: truyện tranh "Ngày hội bãi biển" (các màn cũ và chương Chuyến dã ngoại đã bỏ; tiến độ lưu ở khóa mới `so-sticker-v4`).
Sinh và duyệt: `node tools/level-lab.js gen` (generate-and-test, in salt nên giữ), `node tools/level-lab.js` (duyệt theo bộ skill sticker-level-*).

## Màn truyện tranh: Ngày hội bãi biển

Mỗi trang là một bức tranh, sticker là nhân vật và đồ vật trong tranh; dán kín trang thì trang chuyển dần sang ảnh gốc AI vẽ.
Dữ liệu ở `STORIES.beach` trong `js/hunt.js`: `imgL`/`imgR` là nền từng trang, `fullL`/`fullR` là ảnh gốc, ô dán `[id, x, y, size]` tính theo trang.

Quy trình ảnh (ChatGPT + Gemini, lưu ở `art-gen/beach/`):
1. Gen nền trang (không nhân vật) và một tờ sticker nền trắng cùng phong cách (tải tờ cũ lên làm tham chiếu).
2. `python tools/slice_sheet.py <tờ.png> art-gen/<album>/slices <tiền tố>` cắt từng sticker (thứ tự đọc: hàng trên xuống, trái sang phải).
3. Gen ảnh gốc từng trang từ nền + sticker; đặt ô dán theo vị trí trong ảnh gốc để lúc chuyển cảnh khớp.
4. Chép nền và ảnh gốc vào `art-gen/scenes/`, chạy `python tools/scenes2js.py`, rồi `node tools/build.js`.

