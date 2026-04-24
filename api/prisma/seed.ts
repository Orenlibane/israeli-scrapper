import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const cities = [
  { id: 5000, name: 'Tel Aviv - Yafo',           nameHe: 'תל אביב - יפו',         topArea: 2 },
  { id: 3000, name: 'Jerusalem',                  nameHe: 'ירושלים',               topArea: 3 },
  { id: 4000, name: 'Haifa',                      nameHe: 'חיפה',                   topArea: 1 },
  { id: 8300, name: 'Rishon LeZion',              nameHe: 'ראשון לציון',           topArea: 2 },
  { id: 7900, name: 'Petah Tikva',                nameHe: 'פתח תקווה',             topArea: 2 },
  { id: 70,   name: 'Ashdod',                     nameHe: 'אשדוד',                 topArea: 4 },
  { id: 7400, name: 'Netanya',                    nameHe: 'נתניה',                 topArea: 5 },
  { id: 9000, name: 'Beer Sheva',                 nameHe: 'באר שבע',               topArea: 4 },
  { id: 6600, name: 'Holon',                      nameHe: 'חולון',                 topArea: 2 },
  { id: 6200, name: 'Bnei Brak',                  nameHe: 'בני ברק',               topArea: 2 },
  { id: 8600, name: 'Ramat Gan',                  nameHe: 'רמת גן',                topArea: 2 },
  { id: 6400, name: 'Herzliya',                   nameHe: 'הרצליה',                topArea: 5 },
  { id: 6900, name: 'Kfar Saba',                  nameHe: 'כפר סבא',               topArea: 5 },
  { id: 8400, name: 'Rehovot',                    nameHe: 'רחובות',                topArea: 2 },
  { id: 1200, name: 'Modiin',                     nameHe: 'מודיעין מכבים רעות',   topArea: 2 },
  { id: 8700, name: 'Raanana',                    nameHe: 'רעננה',                 topArea: 5 },
  { id: 650,  name: 'Ashkelon',                   nameHe: 'אשקלון',                topArea: 4 },
  { id: 6300, name: 'Bat Yam',                    nameHe: 'בת ים',                 topArea: 2 },
]

// Key Tel Aviv neighborhoods with Yad2 codes
const neighborhoods = [
  { id: 1388, name: 'Florentin',          nameHe: 'פלורנטין',      cityId: 5000 },
  { id: 1369, name: 'City Center',        nameHe: 'מרכז העיר',     cityId: 5000 },
  { id: 1387, name: 'Neve Tzedek',        nameHe: 'נווה צדק',      cityId: 5000 },
  { id: 1364, name: 'Rothschild',         nameHe: 'רוטשילד',       cityId: 5000 },
  { id: 1395, name: 'Ramat Aviv',         nameHe: 'רמת אביב',      cityId: 5000 },
  { id: 1402, name: 'Ramat Aviv Gimel',   nameHe: 'רמת אביב ג',    cityId: 5000 },
  { id: 1371, name: 'Old North',          nameHe: 'צפון ישן',      cityId: 5000 },
  { id: 1370, name: 'New North',          nameHe: 'צפון חדש',      cityId: 5000 },
  { id: 1396, name: 'Jaffa',              nameHe: 'יפו',            cityId: 5000 },
  { id: 1367, name: 'Lev Tel Aviv',       nameHe: 'לב תל אביב',   cityId: 5000 },
  // Jerusalem
  { id: 1469, name: 'Rehavia',            nameHe: 'רחביה',         cityId: 3000 },
  { id: 1470, name: 'German Colony',      nameHe: 'המושבה הגרמנית', cityId: 3000 },
  // Ramat Gan
  { id: 1521, name: 'Diamond Exchange',   nameHe: 'בורסת היהלומים', cityId: 8600 },
]

async function main() {
  console.log('Seeding cities...')
  for (const city of cities) {
    await prisma.city.upsert({ where: { id: city.id }, update: city, create: city })
  }

  console.log('Seeding neighborhoods...')
  for (const n of neighborhoods) {
    await prisma.neighborhood.upsert({ where: { id: n.id }, update: n, create: n })
  }

  console.log('Seed complete.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
