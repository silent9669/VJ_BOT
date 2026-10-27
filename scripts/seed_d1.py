import subprocess
import json

DATABASE_ID = "eb0d49a5-7a90-4219-968c-5fcb04390859"

lessons = [
    ("minna:1", "minna", "N5", 1, "Minna no Nihongo Bài 1: Làm quen & Giới thiệu bản thân", "https://minna.test/1"),
    ("minna:2", "minna", "N5", 2, "Minna no Nihongo Bài 2: Đồ vật & Sở hữu (これ・それ・あれ)", "https://minna.test/2"),
    ("minna:3", "minna", "N5", 3, "Minna no Nihongo Bài 3: Địa điểm & Nơi chốn (ここ・そこ・あそこ)", "https://minna.test/3"),
    ("minna:4", "minna", "N5", 4, "Minna no Nihongo Bài 4: Thời gian & Thói quen hàng ngày", "https://minna.test/4"),
    ("minna:5", "minna", "N5", 5, "Minna no Nihongo Bài 5: Di chuyển & Đi lại (〜へ行きます)", "https://minna.test/5"),

    ("minna:26", "minna", "N4", 26, "Minna no Nihongo Bài 26: Giải thích lý do (〜んです)", "https://minna.test/26"),
    ("minna:27", "minna", "N4", 27, "Minna no Nihongo Bài 27: Thể khả năng (できる・〜れる)", "https://minna.test/27"),
    ("minna:28", "minna", "N4", 28, "Minna no Nihongo Bài 28: Hành động đồng thời (〜ながら)", "https://minna.test/28"),
    ("minna:29", "minna", "N4", 29, "Minna no Nihongo Bài 29: Trạng thái (〜てしまいます)", "https://minna.test/29"),
    ("minna:30", "minna", "N4", 30, "Minna no Nihongo Bài 30: Chuẩn bị & Sắp đặt (〜てあります・〜ておきます)", "https://minna.test/30"),

    ("shinkanzen:n3_1", "shinkanzen", "N3", 1, "Shinkanzen Master N3: Căn cứ & Nguyên nhân (〜わけだ・〜わけではない)", "https://shinkanzen.test/n3/1"),
    ("shinkanzen:n3_2", "shinkanzen", "N3", 2, "Shinkanzen Master N3: Trạng thái & Mức độ (〜切る・〜げ・〜っぽい)", "https://shinkanzen.test/n3/2"),
    ("shinkanzen:n3_3", "shinkanzen", "N3", 3, "Shinkanzen Master N3: Quan hệ & Đối chiếu (〜を中心に・〜に対して)", "https://shinkanzen.test/n3/3"),

    ("shinkanzen:n2_1", "shinkanzen", "N2", 1, "Shinkanzen Master N2: Phạm vi & Thời gian (〜にわたって・〜に際して)", "https://shinkanzen.test/n2/1"),
    ("shinkanzen:n2_2", "shinkanzen", "N2", 2, "Shinkanzen Master N2: Điều kiện & Bắt buộc (〜を契机に・〜ざるを得ない)", "https://shinkanzen.test/n2/2"),

    ("shinkanzen:n1_1", "shinkanzen", "N1", 1, "Shinkanzen Master N1: Mức độ tột cùng (〜極まりない・〜にたえない)", "https://shinkanzen.test/n1/1"),
    ("shinkanzen:n1_2", "shinkanzen", "N1", 2, "Shinkanzen Master N1: Khởi điểm & Tư cách (〜を皮切りに・〜たるもの)", "https://shinkanzen.test/n1/2"),
]

items = [
    # N5
    ("N5-001", "minna:1", "minna", "N5", 1, "grammar", "grammar", 1, "〜は〜です", "は です", "Khẳng định: A là B (Tôi là sinh viên)", "A is B (topic and state of being)", "https://minna.test/1/1"),
    ("N5-002", "minna:1", "minna", "N5", 1, "grammar", "grammar", 2, "〜じゃありません", "じゃありません", "Phủ định: A không phải là B", "A is not B", "https://minna.test/1/2"),
    ("N5-003", "minna:1", "minna", "N5", 1, "grammar", "grammar", 3, "〜ですか", "ですか", "Câu hỏi nghi vấn cơ bản", "Question particle", "https://minna.test/1/3"),
    ("N5-004", "minna:1", "minna", "N5", 1, "grammar", "grammar", 4, "〜も", "も", "Trợ từ cũng: A cũng là B", "also / too", "https://minna.test/1/4"),
    ("N5-005", "minna:1", "minna", "N5", 1, "grammar", "grammar", 5, "〜の", "の", "Trợ từ sở hữu: N1 của N2", "possessive / modifier particle", "https://minna.test/1/5"),
    ("N5-006", "minna:1", "minna", "N5", 1, "vocab", "vocabulary", 6, "私", "わたし", "Tôi (ngôi thứ nhất)", "I / me", "https://minna.test/1/6"),
    ("N5-007", "minna:1", "minna", "N5", 1, "vocab", "vocabulary", 7, "学生", "がくせい", "Học sinh, sinh viên", "student", "https://minna.test/1/7"),
    ("N5-008", "minna:1", "minna", "N5", 1, "vocab", "vocabulary", 8, "先生", "せんせい", "Giáo viên, thầy cô", "teacher / professor", "https://minna.test/1/8"),
    ("N5-009", "minna:2", "minna", "N5", 2, "grammar", "grammar", 9, "これ・それ・あれ", "これ・それ・あれ", "Chỉ từ đồ vật (Cái này / Cái đó / Cái kia)", "this / that / that over there", "https://minna.test/2/1"),
    ("N5-010", "minna:3", "minna", "N5", 3, "grammar", "grammar", 10, "ここ・そこ・あそこ", "ここ・そこ・あそこ", "Chỉ từ vị trí địa điểm (Ở đây / Ở đó / Ở kia)", "here / there / over there", "https://minna.test/3/1"),
    ("N5-011", "minna:5", "minna", "N5", 5, "grammar", "grammar", 11, "〜へ行きます", "へいきます", "Đi đến một địa điểm nào đó (trợ từ へ)", "go to [place]", "https://minna.test/5/1"),
    ("N5-012", "minna:1", "minna", "N5", 1, "kanji", "kanji", 12, "日", "ニチ・ひ", "Ngày, mặt trời (Nhật)", "sun / day", "https://minna.test/1/12"),
    ("N5-013", "minna:1", "minna", "N5", 1, "kanji", "kanji", 13, "本", "ホン・もと", "Sách, gốc rễ, Nhật Bản (Bản)", "book / origin", "https://minna.test/1/13"),

    # N4
    ("N4-001", "minna:26", "minna", "N4", 26, "grammar", "grammar", 1, "〜んです", "んです", "Nhấn mạnh, giải thích nguyên nhân/lý do", "explanatory mode", "https://minna.test/26/1"),
    ("N4-002", "minna:26", "minna", "N4", 26, "grammar", "grammar", 2, "〜ていただけませんか", "ていただけませんか", "Nhờ vả lịch sự: Có thể làm giúp tôi được không?", "polite request", "https://minna.test/26/2"),
    ("N4-003", "minna:28", "minna", "N4", 28, "grammar", "grammar", 3, "〜ながら", "ながら", "Vừa làm A vừa làm B (hành động song song)", "while doing", "https://minna.test/28/1"),
    ("N4-004", "minna:29", "minna", "N4", 29, "grammar", "grammar", 4, "〜てしまいます", "てしまいます", "Lỡ làm gì đó / Hoàn thành toàn bộ", "do completely / regretfully", "https://minna.test/29/1"),
    ("N4-005", "minna:30", "minna", "N4", 30, "grammar", "grammar", 5, "〜てあります", "てあります", "Diễn tả trạng thái có chủ đích chuẩn bị", "state of being done purposefully", "https://minna.test/30/1"),
    ("N4-006", "minna:30", "minna", "N4", 30, "grammar", "grammar", 6, "〜ておきます", "ておきます", "Làm trước để chuẩn bị cho mục đích sau", "do in advance", "https://minna.test/30/2"),
    ("N4-007", "minna:26", "minna", "N4", 26, "vocab", "vocabulary", 7, "案内します", "あんないします", "Hướng dẫn, dẫn đường", "to guide / show around", "https://minna.test/26/7"),
    ("N4-008", "minna:26", "minna", "N4", 26, "vocab", "vocabulary", 8, "都合", "つごう", "Tình hình, điều kiện thuận lợi về thời gian", "circumstances / convenience", "https://minna.test/26/8"),
    ("N4-009", "minna:26", "minna", "N4", 26, "kanji", "kanji", 9, "会", "カイ・あう", "Hội (gặp gỡ, cuộc họp)", "meet / gathering", "https://minna.test/26/9"),
    ("N4-010", "minna:26", "minna", "N4", 26, "kanji", "kanji", 10, "社", "シャ・やしろ", "Xã (công ty, đền thần)", "company / shrine", "https://minna.test/26/10"),

    # N3
    ("N3-001", "shinkanzen:n3_1", "shinkanzen", "N3", 1, "grammar", "grammar", 1, "〜わけだ", "わけだ", "Thảo nào, thành ra là như vậy (kết luận tất yếu)", "naturally / no wonder", "https://shinkanzen.test/n3/1/1"),
    ("N3-002", "shinkanzen:n3_1", "shinkanzen", "N3", 1, "grammar", "grammar", 2, "〜わけではない", "わけではない", "Không hẳn là, không có nghĩa là (phủ định một phần)", "it does not mean that", "https://shinkanzen.test/n3/1/2"),
    ("N3-003", "shinkanzen:n3_2", "shinkanzen", "N3", 2, "grammar", "grammar", 3, "〜切る", "きる", "Làm hết sạch / Làm tới cùng dứt khoát", "do completely / to the end", "https://shinkanzen.test/n3/2/1"),
    ("N3-004", "shinkanzen:n3_2", "shinkanzen", "N3", 2, "grammar", "grammar", 4, "〜げ", "げ", "Có vẻ, mang sắc thái (tâm trạng, cảm xúc)", "appearing / seeming", "https://shinkanzen.test/n3/2/2"),
    ("N3-005", "shinkanzen:n3_3", "shinkanzen", "N3", 3, "grammar", "grammar", 5, "〜を中心に", "をちゅうしんに", "Lấy cái gì đó làm trung tâm / trọng tâm", "centering on / focusing on", "https://shinkanzen.test/n3/3/1"),
    ("N3-006", "shinkanzen:n3_3", "shinkanzen", "N3", 3, "grammar", "grammar", 6, "〜に対して", "にたいして", "Đối với / Trái ngược với", "towards / in contrast to", "https://shinkanzen.test/n3/3/2"),
    ("N3-007", "shinkanzen:n3_1", "shinkanzen", "N3", 1, "vocab", "vocabulary", 7, "状況", "じょうきょう", "Tình huống, hoàn cảnh hiện tại", "situation / state of affairs", "https://shinkanzen.test/n3/1/7"),
    ("N3-008", "shinkanzen:n3_1", "shinkanzen", "N3", 1, "vocab", "vocabulary", 8, "影響", "えいきょう", "Sự ảnh hưởng, tác động", "influence / effect", "https://shinkanzen.test/n3/1/8"),
    ("N3-009", "shinkanzen:n3_1", "shinkanzen", "N3", 1, "kanji", "kanji", 9, "政", "セイ・まつりごと", "Chính (chính trị, nhà nước)", "politics / government", "https://shinkanzen.test/n3/1/9"),

    # N2
    ("N2-001", "shinkanzen:n2_1", "shinkanzen", "N2", 1, "grammar", "grammar", 1, "〜にわたって", "にわたって", "Suốt, trải rộng trên (thời gian, không gian)", "throughout / across", "https://shinkanzen.test/n2/1/1"),
    ("N2-002", "shinkanzen:n2_1", "shinkanzen", "N2", 1, "grammar", "grammar", 2, "〜に際して", "にさいして", "Nhân dịp, khi chuẩn bị thực hiện việc trọng đại", "on the occasion of", "https://shinkanzen.test/n2/1/2"),
    ("N2-003", "shinkanzen:n2_2", "shinkanzen", "N2", 2, "grammar", "grammar", 3, "〜を契機に", "をけいきに", "Lấy làm cơ hội, bước ngoặt để thay đổi", "taking opportunity of", "https://shinkanzen.test/n2/2/1"),
    ("N2-004", "shinkanzen:n2_2", "shinkanzen", "N2", 2, "grammar", "grammar", 4, "〜ざるを得ない", "ざるをえない", "Đành phải, không thể không làm", "cannot help doing", "https://shinkanzen.test/n2/2/2"),
    ("N2-005", "shinkanzen:n2_1", "shinkanzen", "N2", 1, "vocab", "vocabulary", 5, "傾向", "けいこう", "Khuynh hướng, xu thế", "tendency / trend", "https://shinkanzen.test/n2/1/5"),
    ("N2-006", "shinkanzen:n2_1", "shinkanzen", "N2", 1, "vocab", "vocabulary", 6, "把握", "はあく", "Nắm bắt, thấu hiểu tường tận", "grasp / comprehend", "https://shinkanzen.test/n2/1/6"),
    ("N2-007", "shinkanzen:n2_1", "shinkanzen", "N2", 1, "kanji", "kanji", 7, "統", "トウ・すべる", "Thống (thống nhất, thống trị)", "unite / rule", "https://shinkanzen.test/n2/1/7"),

    # N1
    ("N1-001", "shinkanzen:n1_1", "shinkanzen", "N1", 1, "grammar", "grammar", 1, "〜極まりない", "きわまりない", "Vô cùng, hết sức (mức độ cực độ tiêu cực/tích cực)", "extremely / without limits", "https://shinkanzen.test/n1/1/1"),
    ("N1-002", "shinkanzen:n1_1", "shinkanzen", "N1", 1, "grammar", "grammar", 2, "〜にたえない", "にたえない", "Không thể chịu nổi / Không kìm nén được cảm xúc", "cannot bear / overwhelmed with", "https://shinkanzen.test/n1/1/2"),
    ("N1-003", "shinkanzen:n1_2", "shinkanzen", "N1", 2, "grammar", "grammar", 3, "〜を皮切りに", "をかわきりに", "Bắt đầu với, mở màn bằng một sự kiện nối tiếp", "starting with / beginning with", "https://shinkanzen.test/n1/2/1"),
    ("N1-004", "shinkanzen:n1_2", "shinkanzen", "N1", 2, "grammar", "grammar", 4, "〜たるもの", "たるもの", "Đã là (người có vị trí, cương vị) thì phải xứng đáng", "as someone who is", "https://shinkanzen.test/n1/2/2"),
    ("N1-005", "shinkanzen:n1_1", "shinkanzen", "N1", 1, "vocab", "vocabulary", 5, "妥協", "だきょう", "Thỏa hiệp, nhượng bộ", "compromise", "https://shinkanzen.test/n1/1/5"),
    ("N1-006", "shinkanzen:n1_1", "shinkanzen", "N1", 1, "vocab", "vocabulary", 6, "緻密", "ちみつ", "Chính xác, tỉ mỉ, chi tiết", "meticulous / detailed", "https://shinkanzen.test/n1/1/6"),
    ("N1-007", "shinkanzen:n1_1", "shinkanzen", "N1", 1, "kanji", "kanji", 7, "鑑", "カン・かんがみる", "Giám (gương soi, giám định)", "specimen / reflect on", "https://shinkanzen.test/n1/1/7"),
]

statements = []
for l in lessons:
    statements.append(f"""INSERT OR REPLACE INTO curriculum_lessons (lesson_id, book, level, lesson, title, source_url)
VALUES ('{l[0]}', '{l[1]}', '{l[2]}', {l[3]}, '{l[4]}', '{l[5]}');""")

for it in items:
    statements.append(f"""INSERT OR REPLACE INTO curriculum_items (item_id, lesson_id, book, level, lesson, section, item_type, order_num, display, reading, meaning_vi, meaning_en, source_url)
VALUES ('{it[0]}', '{it[1]}', '{it[2]}', '{it[3]}', {it[4]}, '{it[5]}', '{it[6]}', {it[7]}, '{it[8]}', '{it[9]}', '{it[10]}', '{it[11]}', '{it[12]}');""")

full_sql = "\n".join(statements)
with open("/tmp/seed.sql", "w", encoding="utf-8") as f:
    f.write(full_sql)

print(f"Generated {len(statements)} SQL statements.")
