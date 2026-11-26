# Mirkomil Server

Oddiy kompyuterni **bitta buyruq** bilan xavfsiz, o'zini o'zi kuzatadigan uy serveriga aylantiradi —
chiroyli boshqaruv paneli bilan (Cockpit plagini).

> Holat: **ishlab chiqilmoqda (v0.1)**. Tayyor: o'rnatuvchi, panel (3 rejim), Guardian monitoring va
> avtomatik tuzatish. Keyingi bosqichlar: ilovalarni deploy qilish (PaaS), Cloudflare Tunnel va domenlar,
> foydalanuvchilar va rollar, zaxira nusxalar.

## Nima o'rnatiladi

| Qism | Vazifasi |
|---|---|
| Xavfsizlik | ufw (kiruvchi ulanishlar yopiq), fail2ban, SSH faqat kalit bilan (avval kalit ishlashi tekshiriladi), avtomatik xavfsizlik yangilanishlari |
| Tizim | uyqu o'chirilgan, jurnal hajmi cheklangan, yadro sozlamalari, vaqt mintaqasi |
| Docker | Ubuntu'ning rasmiy (imzolangan) paketlaridan, loglar cheklangan |
| Cockpit | veb-konsol + PCP (grafiklar tarixi), brendlangan kirish sahifasi |
| Mirkomil Panel | Cockpit ichidagi panel: Oddiy / Kengaytirilgan / Ixcham rejimlar, o'zbek/rus/ingliz |
| Guardian | har 30 soniyada tekshiradi, tarixni saqlaydi, Telegram'ga xabar beradi, muammolarni o'zi tuzatadi |
| Tailscale | serverga istalgan joydan xavfsiz kirish (port ochmasdan) |

## O'rnatish

Talab: toza **Ubuntu Server 26.04 LTS**, internet, `sudo` huquqli foydalanuvchi.

```bash
curl -fsSL https://raw.githubusercontent.com/MirkomilCoder/mirkomil-server/main/install.sh | sudo bash
```

Dastur bir nechta savol beradi (server nomi, administrator, vaqt mintaqasi, domen, Tailscale, Telegram)
va qolganini o'zi qiladi. Oxirida panel manzili va qo'lda qilinadigan 2–3 ish ko'rsatiladi.

Savolsiz o'rnatish (masalan, bir nechta server uchun):

```bash
cp installer/config.example.env config.env   # qiymatlarni tahrirlang
sudo ./install.sh --yes --config config.env
```

Maxfiy kalitlar (Tailscale, Telegram tokenlari) faqat `/etc/mirkomil/secrets.env` faylida saqlanadi
(`root`, `0600`) — hech qachon logga yoki repoga tushmaydi.

## Panelga kirish

* Uy tarmog'ida: `https://<server-ip>:9090` → chap menyuda **Mirkomil Panel**
* Tailscale orqali: `https://<tailscale-ip>:9090`
* Login — serverdagi Linux foydalanuvchingiz va paroli.

Brauzer birinchi marta "sertifikat ishonchsiz" deydi: bu Cockpit'ning o'z sertifikati. Domen ulanganidan
keyin (Cloudflare Tunnel) bu ogohlantirish yo'qoladi.

## Kundalik buyruqlar (SSH orqali)

```bash
mirkomil status          # qisqa holat
mirkomil doctor          # 14 ta tekshiruv + tuzatish bo'yicha maslahat
sudo mirkomil repair     # sozlamalarni qayta tekshirish va tuzatish
sudo mirkomil update     # yangi versiyani o'rnatish
mirkomil logs            # o'rnatuvchi logi
```

## Yangilash va olib tashlash

```bash
sudo mirkomil update
sudo /opt/mirkomil/src/install.sh --uninstall
```

`--uninstall` Mirkomil sozlamalarini olib tashlaydi, lekin **ma'lumotlarga tegmaydi**: Docker
konteynerlari/volumelari, bazalar, uy papkalari, Guardian tarixi saqlanadi; firewall yoqiq qoladi.

## Guardian: o'zini o'zi tuzatish

Guardian o'rnatilgandan keyin **sinov rejimida** ishlaydi: muammoni topsa nima qilishini faqat yozib
boradi. Panel → **Nazorat** → *Avtomatik tuzatish* bo'limida tarixni ko'rib chiqing va "Avtomatik"ni yoqing.

| Muammo | Avtomatik amal |
|---|---|
| Servis ishlamay qoldi | qayta ishga tushirish (5 daq oraliq, 3 urinish, keyin ogohlantirish) |
| Disk to'lmoqda (85%+) | apt kesh → jurnal → eski Docker obrazlari (volumelar hech qachon o'chirilmaydi) |
| Tailscale uzildi | tailscaled'ni qayta ishga tushirish |
| Internet yo'q (3 daq+) | tarmoq servisini va Tailscale'ni qayta ishga tushirish |
| Internet 15 daq+ yo'q | serverni qayta yoqish — **sukut bo'yicha o'chiq**, panelda yoqiladi |

## Dasturchilar uchun

```
install.sh            bootstrap (GitHub release'dan yuklab, installer/ ni ishga tushiradi)
installer/            modullar: 00-preflight … 99-summary (har biri qayta ishga tushirishga xavfsiz)
panel/                Cockpit plagini: React + TypeScript + Vite
agent/mirkomil/       Guardian, API (Unix socket), root helper — faqat Python standart kutubxonasi
configs/              boshqariladigan konfiguratsiya fayllari va systemd unitlari
tests/                bats (o'rnatuvchi), pytest (agent)
```

Panelni ishlab chiqish:

```bash
cd panel
npm ci
npm run dev                       # brauzerda, soxta (mock) ma'lumotlar bilan
npm run build && npm run deploy   # VM'ga: ~/.local/share/cockpit/mirkomil
```

* **Yangi sahifa:** `panel/src/pages/MyPage.tsx` yarating, `pages/registry.ts` ga qo'shing,
  `i18n/*.json` ga `nav.<id>` kalitini qo'shing.
* **Yangi rejim:** `panel/src/modes/MyMode.tsx` + `modes/index.ts` dagi ro'yxatga bitta qator.
* **Yangi amal (buyruq):** faqat `panel/src/api/actions.ts` dagi oq ro'yxatga — argv massiv, zod
  bilan tekshirilgan parametrlar. Panel boshqa hech qanday buyruqni ishga tushira olmaydi.
* **Root kerak bo'lgan amal:** `agent/mirkomil/helper.py` dagi `VERBS` ga yangi, qat'iy tekshirilgan verb.

Testlar:

```bash
bats tests/bats
PYTHONPATH=agent python3 -m pytest tests/agent
cd panel && npm run typecheck
```

Xavfsizlik modeli: [SECURITY.md](SECURITY.md).
