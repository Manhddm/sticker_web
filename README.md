# Sổ Sticker

Game riêng, tách từ Peel Pixel. Luật tile match + truyện: bóc sticker vào khay 7 ô, đủ 3 cái giống nhau thì nổ, và mỗi bộ 3 nổ ra một sticker bay vào ô của nó trên trang sổ (mỗi ô là một bộ 3).
Bộ 3 của loại mà trang đôi đang mở không còn ô nào thì được cất lại, dán ngay khi lật tới trang có ô đó; bộ 3 "mồi" (loại sổ không cần) chỉ dọn khay. Đủ hai trang thì lật sổ.
Bóc hết tờ (dán kín mọi trang) là thắng; khay đầy là thua. Sao tính theo số ô khay đầy nhất trong ván (Core.starsFor).
Khay, trợ thủ (Thêm ô, Nam châm, Xáo trộn), thắng/thua và sao là của `js/game.js` (chế độ khay gom 3 có sẵn của Peel Off); cuốn sổ chỉ nghe sự kiện nổ bộ 3.

Chơi: mở `dist/so-sticker.html` (một file, gửi đi là chơi được), hoặc `python -m http.server` trong thư mục này rồi mở `index.html`.
Build: `node tools/build.js`. Test: `node tools/test-hunt.js` (tờ có đúng 3 sticker mỗi ô cộng bộ mồi, lời giải mẫu thắng trong khay 7 ô, bot thắng đủ thường).

- `js/hunt.js`: dữ liệu màn (trang demo, màn truyện bãi biển) và `build`: cấu hình tờ cho `Core.buildLevel` (mỗi ô một bộ 3; lời giải mẫu và bot là của `core.js`).
- `js/book.js`: cuốn sổ (ô, bộ đếm, lật trang, chuyển sang ảnh gốc), bay sticker từ khay vào ô, nút trợ thủ, màn chọn màn.
- `js/game.js`, `core.js`, `art.js`, `audio.js`, `i18n.js`: tờ sticker, hình vẽ sticker, âm thanh (bản riêng của game này).

Code tách hẳn khỏi `../PeelOff`. Tiến độ lưu riêng (`so-sticker-v5`).

## Level

6 màn: 5 màn demo lối chơi (trang giấy, không tranh) rồi màn truyện tranh "Ngày hội bãi biển". Tiến độ lưu ở khóa `so-sticker-v5`.

| Màn | tier | ô mỗi trang | sticker | peak | greedy |
|---|---|---|---|---|---|
| 1 | teach | 1/1/2/2, 1 loại mỗi trang, không chồng | 18 | 4 | 1.00 |
| 2 | teach | 2/2/3/3 | 30 | 4 | 0.99 |
| 3 | practice | 3×4 | 36 | 5 | 0.92 |
| 4 | practice | 4×4, 1 bộ mồi | 51 | 5 | 0.81 |
| 5 | hard | 5×4, 1 bộ mồi | 63 | 6 | 0.61 |
| 6 | practice | truyện tranh bãi biển 6/5/5/5 | 63 | 4 | 0.80 |

peak: số ô khay nhiều nhất mà lời giải mẫu dùng (thấp là dễ); greedy: tỉ lệ thắng của bot chơi chú ý (10% nước lơ đễnh).
Phản hồi khi bóc: ô của loại vừa bóc tỏa vòng vàng; ô đầu tiên của mỗi loại có vòng xanh đầy dần theo số sticker loại đó trong khay (1/3, 2/3); chân trang có bộ đếm ô đã dán.
Sinh và duyệt: `node tools/level-lab.js gen` (thử salt, chọn cái gần giữa dải của tier), `node tools/level-lab.js` (duyệt từng màn).

## Màn truyện tranh: Ngày hội bãi biển

Mỗi trang là một bức tranh, sticker là nhân vật và đồ vật trong tranh; dán kín trang thì trang chuyển dần sang ảnh gốc AI vẽ.
Dữ liệu ở `STORIES.beach` trong `js/hunt.js`: `imgL`/`imgR` là nền từng trang, `fullL`/`fullR` là ảnh gốc, ô dán `[id, x, y, size]` tính theo trang.

Quy trình ảnh (ChatGPT + Gemini, lưu ở `art-gen/beach/`):
1. Gen nền trang (không nhân vật) và một tờ sticker nền trắng cùng phong cách (tải tờ cũ lên làm tham chiếu).
2. `python tools/slice_sheet.py <tờ.png> art-gen/<album>/slices <tiền tố>` cắt từng sticker (thứ tự đọc: hàng trên xuống, trái sang phải).
3. Gen ảnh gốc từng trang từ nền + sticker; đặt ô dán theo vị trí trong ảnh gốc để lúc chuyển cảnh khớp.
4. Chép nền và ảnh gốc vào `art-gen/scenes/`, chạy `python tools/scenes2js.py`, rồi `node tools/build.js`.

