# Sổ Sticker

Game riêng, tách từ Peel Pixel. Mỗi trang sổ là một nhiệm vụ: trang cần một bộ sticker theo chủ đề, có số lượng (ví dụ 2 dâu + 1 nho + 3 kiwi).
Mọi sticker bóc ra đều vào khay. Khi khay có đủ bộ của trang đang mở, cả bộ bay lên dán kín trang; trang trái xong thì tới trang phải, xong cả hai thì lật sổ.
Dán kín mọi trang là thắng; khay đầy mà chưa đủ bộ nào là thua. Sao tính theo số sticker trang đang mở không cần mà vẫn bóc, so với chuẩn của màn.

Chơi: mở `dist/so-sticker.html` (một file, gửi đi là chơi được), hoặc `python -m http.server` trong thư mục này rồi mở `index.html`.
Build: `node tools/build.js`. Test: `node tools/test-hunt.js` (mọi trang có lời giải, bot cẩn thận thắng đủ thường, in độ khó và chuẩn).

- `js/hunt.js`: luật (khay, nhiệm vụ theo trang), cách chia sticker có lời giải mẫu, bot, danh sách 12 màn.
- `js/book.js`: màn chơi: cuốn sổ và lật trang, khay, trợ thủ, combo, màn chọn màn.
- `js/game.js`, `core.js`, `art.js`, `audio.js`, `i18n.js`: tờ sticker, hình vẽ sticker, âm thanh (bản riêng của game này).

Code tách hẳn khỏi `../PeelOff`. Tiến độ lưu riêng (`so-sticker-v3`).

## Level (làm bằng bộ skill sticker-level-*)

Curriculum (Koster): 12 màn, nhịp teach → practice → practice → twist → hard → breather, rồi lặp lại với quy luật mới là sticker úp (teach ở màn 7) và đỉnh cao hơn.
Các núm: khay, độ dày tờ (`bottom`), số loại mỗi trang, số trang, sticker mồi (`decoys`, `lids` là số mồi đè lên sticker trang cuối), sticker úp.
Keo (sticker phải bóc 2 lần) chưa có trong game: cần thêm cơ chế trước khi đưa vào curriculum.

| Màn | tier | trọng tâm | khay | trang | mồi/nắp | úp | greedy (mục tiêu) |
|---|---|---|---|---|---|---|---|
| 1 | teach | gom đủ bộ vào khay | 7 | 3/3 | 0 | – | 1.00 (0.95–1) |
| 2 | practice | đào lớp | 6 | 3×4 | 0 | – | 0.86 (0.80–0.95) |
| 3 | practice | nhiều trang, giữ chỗ trang sau | 6 | 4×4 | 0 | – | 0.89 |
| 4 | twist | sticker mồi đè trang cuối | 6 | 5×4 | 2/2 | – | 0.77 (0.65–0.85) |
| 5 | hard | khay chật + trang sau nằm trên | 6 | 5×4 | 2/1 | – | 0.64 (0.45–0.70) |
| 6 | breather | xả hơi | 7 | 3/4/3/4 | 0 | – | 0.98 (0.90–1) |
| 7 | teach | sticker úp lần đầu | 7 | 4×4 | 0 | 15% | 0.99 |
| 8 | practice | úp + mồi | 7 | 5×4 | 2/1 | 12% | 0.84 |
| 9 | twist | 6 trang, 4 loại mỗi trang | 6 | 5×6 | 2/1 | 10% | 0.74 |
| 10 | hard | trang 6 sticker, 2 nắp | 7 | 6×4 | 3/2 | 10% | 0.59 |
| 11 | breather | xả hơi (khó hơn màn 6) | 7 | 4×4 | 0 | – | 0.99 |
| 12 | superhard | tất cả cùng lúc | 7 | 6×6 | 2/2 | 10% | 0.35 (0.30–0.50) |

Sinh và duyệt: `node tools/level-lab.js gen` (generate-and-test, in dải biểu đạt và salt nên giữ), `node tools/level-lab.js` (duyệt theo skill: giải được, greedy trong dải, khoảng cách với random ≥ 0.15, ≥ 2 lựa chọn mở đầu, near-miss, mức tăng nhờ trợ thủ +1 ô, thua ở trang đôi cuối, quãng không tiến triển ≤ 0.5, tỉ lệ bấm ở 1/3 trên ≤ 0.35).
Màn 5, 9, 12 chưa đạt ngưỡng near-miss của skill (thua khi thiếu ≤ 3 sticker): với luật đủ cả bộ mới điền, thua ở trang cuối thường vẫn thiếu 4–6 cái. Ngưỡng này cần hiệu chỉnh bằng số liệu người chơi thật.

