import {
  PrismaClient,
  UserRole,
  IngredientCategory,
  StockUnit,
  SupplierCategory,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── CSV Parsers ─────────────────────────────────────────────────────────────

function parseInventoryCSV(
  csv: string,
): { category: string; code: string; name: string }[] {
  return csv
    .trim()
    .split('\n')
    .map((line) => {
      const [category, code, ...nameParts] = line.split(',');
      return {
        category: category.trim(),
        code: code.trim(),
        name: nameParts.join(',').trim(),
      };
    });
}

function parseMenuCSV(
  csv: string,
): {
  subCategory: string;
  parentCategory: string;
  kitchen: string;
  name: string;
  description: string;
  status: string;
  variant: string;
  price: number;
}[] {
  return csv
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.split(',');
      const subCategory = parts[0]?.trim() ?? '';
      const parentCategory = parts[1]?.trim() ?? '';
      const kitchen = parts[2]?.trim() ?? '';
      const name = parts[3]?.trim() ?? '';
      // Find status column (Active/Inactive)
      const statusIdx = parts.findIndex(
        (p, i) =>
          i > 3 && (p.trim() === 'Active' || p.trim() === 'Inactive'),
      );
      const description =
        statusIdx > 4
          ? parts.slice(4, statusIdx).join(',').trim()
          : (parts[4]?.trim() ?? '');
      const status = statusIdx >= 0 ? parts[statusIdx].trim() : 'Active';
      const variant =
        statusIdx >= 0
          ? (parts[statusIdx + 1]?.trim() ?? '')
          : (parts[6]?.trim() ?? '');
      const price = parseInt(parts[parts.length - 1]?.trim() ?? '0') || 0;
      return {
        subCategory,
        parentCategory,
        kitchen,
        name,
        description,
        status,
        variant,
        price,
      };
    });
}

// ── Inventory Data (parsed from restaurant CSV export) ──────────────────────

const INVENTORY_DATA = parseInventoryCSV(`Bakery,BAK0001,Sandwich Bread
Bakery,BAK0002,Milk Bread
Bakery,BAK0003,Brown Bread
Bakery,BAK0004,Bread Crumbs White
Bakery,BAK0005,Bread Crumb Red
Bakery,BAK0006,Digestive Biscuit
Bakery,BAK0007,Burger Bun
Coffee & Drinks,CHC0001,Coffee Bean
Coffee & Drinks,CHC0002,Oreo Biscuit
Coffee & Drinks,CHC0003,Cloudy Syrup (Monin)
Coffee & Drinks,CHC0004,Strawberry Syrup (Monin)
Coffee & Drinks,CHC0005,Hazelnut Syrup (Monin)
Coffee & Drinks,CHC0006,Coconut Syrup (Monin)
Coffee & Drinks,CHC0007,Passion Fruit Syrup (Monin)
Coffee & Drinks,CHC0008,Salted Caramel Syrup (Monin)
Coffee & Drinks,CHC0009,Vanilla Syrup (Monin)
Coffee & Drinks,CHC0010,Sugar Syrup
Coffee & Drinks,CHC0011,Soda Water
Coffee & Drinks,CHC0012,Cocoa Powder
Coffee & Drinks,CHC0013,Hot Chocolate Powder (Monin)
Coffee & Drinks,CHC0014,Topping Cream for Barista
Coffee & Drinks,CHC0015,Vanilla Essence
Coffee & Drinks,CHC0016,Hot Chocolate Sauce (Monin)
Coffee & Drinks,CHC0017,Hersheys Chocolate Syrup
Coffee & Drinks,CHC0018,Hersheys Caramel Syrup
Coffee & Drinks,CHC0019,Xanthan Gum
Coffee & Drinks,CHC0020,Green Apple Syrup (Monin)
Coffee & Drinks,CHC0021,Tea Bag
Coffee & Drinks,CHC0022,White Sugar Sachet
Coffee & Drinks,CHC0023,Zerocal
Coffee & Drinks,CHC0024,Barista Whipped Cream
Coffee & Drinks,CHC0025,Nutella
Coffee & Drinks,CHC0026,Blueberry Puree (Monin)
Coffee & Drinks,CHC0027,Peanut Butter
Coffee & Drinks,CHC0028,Peach Puree (Monin)
Coffee & Drinks,CHC0029,Curacao Syrup (Monin)
Coffee & Drinks,CHC0030,Blueberry Filling
Coffee & Drinks,CHC0031,Strawberry Filling
Coffee & Drinks,CHC0032,Snickers Chocolate
Coffee & Drinks,CHC0033,Herfey Strawberry Syrup
Coffee & Drinks,CHC0034,Chocolate Chips
Coffee & Drinks,CHC0035,Fruit Mix Lychee (Monin)
Coffee & Drinks,CHC0036,Caramel Sauce (Monin)
Coffee & Drinks,CHC0037,Passion Fruit Puree (Monin)
Coffee & Drinks,CHC0038,Blue Coraco Syrup (Monin)
Coffee & Drinks,CHC0039,Strawberry Puree (Monin)
Coffee & Drinks,CHC0040,Browon Sugar Sachet
Coffee & Drinks,CHC0041,Dark Chocolate Sauce (Davinci)
Coffee & Drinks,CHC0042,Brownie
Coffee & Drinks,CHC0043,Fizz Drinks (coke/sprite)
Dairy,DAR0001,Fresh Milk
Dairy,DAR0002,Cream (Heavy)
Dairy,DAR0003,Butter (Unsalted)
Dairy,DAR0004,Butter (Salted)
Dairy,DAR0005,Cheddar Cheese
Dairy,DAR0006,Mozzarella Cheese
Dairy,DAR0007,Parmesan Cheese
Dairy,DAR0008,Cream Cheese
Dairy,DAR0009,Yoghurt (Plain)
Dairy,DAR0010,Sour Cream
Dairy,DAR0011,Condensed Milk
Dairy,DAR0012,Evaporated Milk
Dairy,DAR0013,Whipping Cream
Dairy,DAR0014,Ghee
Dairy,DAR0015,Paneer
Dairy,DAR0016,Processed Cheese Slice
Dairy,DAR0017,Mascarpone
Dairy,DAR0018,Feta Cheese
Dairy,DAR0019,Ricotta Cheese
Dairy,DAR0020,Coconut Cream
Drinks,DRN0001,Coca Cola 250ml
Drinks,DRN0002,Sprite 250ml
Drinks,DRN0003,Fanta 250ml
Drinks,DRN0004,7 Up 250ml
Drinks,DRN0005,Pepsi 250ml
Drinks,DRN0006,Red Bull
Drinks,DRN0007,Mineral Water 500ml
Drinks,DRN0008,Mineral Water 1.5L
Drinks,DRN0009,Tonic Water
Drinks,DRN0010,Ginger Ale
Drinks,DRN0011,Club Soda
Drinks,DRN0012,Lemon Soda
Drinks,DRN0013,Energy Drink Monster
Drinks,DRN0014,Coconut Water
Drinks,DRN0015,Mango Frooti
Fish,FSH0001,Salmon Fillet
Fish,FSH0002,Tuna Steak
Fish,FSH0003,Prawns (Tiger)
Fish,FSH0004,Prawns (Small)
Fish,FSH0005,Squid (Whole)
Fish,FSH0006,Squid Ring
Fish,FSH0007,Crab Meat
Fish,FSH0008,Lobster Tail
Fish,FSH0009,Sea Bass Fillet
Fish,FSH0010,Hilsha Fish
Fish,FSH0011,Rui Fish
Fish,FSH0012,Katla Fish
Fish,FSH0013,Tilapia Fillet
Fish,FSH0014,Pangash Fish
Fish,FSH0015,Bhetki Fish
Fish,FSH0016,Shrimp (Dried)
Fish,FSH0017,Fish Ball
Fish,FSH0018,Surimi (Crab Stick)
Fish,FSH0019,Octopus
Fish,FSH0020,Scallop
Fish,FSH0021,Clam
Fish,FSH0022,Anchovy (Dried)
Fish,FSH0023,Smoked Salmon
Fish,FSH0024,Sushi Grade Tuna
Fish,FSH0025,Salmon Roe
Frozen,FRZ0001,Frozen Chicken Wings
Frozen,FRZ0002,Frozen French Fries
Frozen,FRZ0003,Frozen Mixed Vegetables
Frozen,FRZ0004,Frozen Sweet Corn
Frozen,FRZ0005,Frozen Green Peas
Frozen,FRZ0006,Frozen Shrimp
Frozen,FRZ0007,Frozen Dumpling Wrapper
Frozen,FRZ0008,Frozen Spring Roll Wrapper
Frozen,FRZ0009,Frozen Paratha
Frozen,FRZ0010,Frozen Samosa
Frozen,FRZ0011,Frozen Wonton Skin
Frozen,FRZ0012,Frozen Gyoza Wrapper
Frozen,FRZ0013,Frozen Puff Pastry
Frozen,FRZ0014,Frozen Edamame
Frozen,FRZ0015,Frozen Berries Mix
Frozen,FRZ0016,Frozen Mango Chunk
Frozen,FRZ0017,Frozen Strawberry
Frozen,FRZ0018,Frozen Hash Brown
Frozen,FRZ0019,Frozen Onion Ring
Frozen,FRZ0020,Frozen Mozzarella Stick
Grain,GRN0001,Basmati Rice
Grain,GRN0002,Jasmine Rice
Grain,GRN0003,Sticky Rice (Glutinous)
Grain,GRN0004,Sushi Rice
Grain,GRN0005,Brown Rice
Grain,GRN0006,All Purpose Flour (Maida)
Grain,GRN0007,Wheat Flour (Atta)
Grain,GRN0008,Corn Flour
Grain,GRN0009,Rice Flour
Grain,GRN0010,Semolina (Suji)
Grain,GRN0011,Oats
Grain,GRN0012,Ramen Noodles
Grain,GRN0013,Egg Noodles
Grain,GRN0014,Rice Noodles (Vermicelli)
Grain,GRN0015,Udon Noodles
Grain,GRN0016,Soba Noodles
Grain,GRN0017,Glass Noodles
Grain,GRN0018,Spaghetti Pasta
Grain,GRN0019,Penne Pasta
Grain,GRN0020,Macaroni Pasta
Grain,GRN0021,Lasagna Sheet
Grain,GRN0022,Panko Bread Crumbs
Grain,GRN0023,Tapioca Starch
Grain,GRN0024,Potato Starch
Grain,GRN0025,Chickpea Flour (Besan)
Ice Cream,ICR0001,Vanilla Ice Cream (5L Tub)
Ice Cream,ICR0002,Chocolate Ice Cream (5L Tub)
Ice Cream,ICR0003,Strawberry Ice Cream (5L Tub)
Ice Cream,ICR0004,Mango Ice Cream (5L Tub)
Ice Cream,ICR0005,Matcha Ice Cream (5L Tub)
Ice Cream,ICR0006,Cookies & Cream Ice Cream (5L Tub)
Ice Cream,ICR0007,Butterscotch Ice Cream (5L Tub)
Ice Cream,ICR0008,Pistachio Ice Cream (5L Tub)
Ice Cream,ICR0009,Salted Caramel Ice Cream (5L Tub)
Ice Cream,ICR0010,Coconut Ice Cream (5L Tub)
Ice Cream,ICR0011,Waffle Cone
Ice Cream,ICR0012,Ice Cream Cup
Ice Cream,ICR0013,Chocolate Sprinkle
Ice Cream,ICR0014,Rainbow Sprinkle
Ice Cream,ICR0015,Whipped Cream Can
Juice & Vinager,JUI0001,Orange Juice (Fresh)
Juice & Vinager,JUI0002,Apple Juice (Bottled)
Juice & Vinager,JUI0003,Pineapple Juice (Bottled)
Juice & Vinager,JUI0004,Cranberry Juice
Juice & Vinager,JUI0005,Pomegranate Juice
Juice & Vinager,JUI0006,White Vinegar
Juice & Vinager,JUI0007,Apple Cider Vinegar
Juice & Vinager,JUI0008,Rice Vinegar
Juice & Vinager,JUI0009,Balsamic Vinegar
Juice & Vinager,JUI0010,Red Wine Vinegar
Juice & Vinager,JUI0011,Lime Juice (Bottled)
Juice & Vinager,JUI0012,Lemon Juice (Bottled)
Juice & Vinager,JUI0013,Tamarind Paste
Juice & Vinager,JUI0014,Mango Pulp
Juice & Vinager,JUI0015,Coconut Milk
Meat,MET0001,Chicken Breast (Boneless)
Meat,MET0002,Chicken Thigh (Boneless)
Meat,MET0003,Chicken Drumstick
Meat,MET0004,Whole Chicken
Meat,MET0005,Chicken Wing
Meat,MET0006,Chicken Liver
Meat,MET0007,Chicken Mince
Meat,MET0008,Beef Sirloin
Meat,MET0009,Beef Tenderloin
Meat,MET0010,Beef Ribeye
Meat,MET0011,Beef Mince
Meat,MET0012,Beef Short Rib
Meat,MET0013,Beef Brisket
Meat,MET0014,Beef Shank
Meat,MET0015,Lamb Chop
Meat,MET0016,Lamb Leg
Meat,MET0017,Lamb Mince
Meat,MET0018,Mutton (Bone-in)
Meat,MET0019,Mutton (Boneless)
Meat,MET0020,Duck Breast
Meat,MET0021,Duck (Whole)
Meat,MET0022,Beef Burger Patty
Meat,MET0023,Chicken Sausage
Meat,MET0024,Beef Sausage
Meat,MET0025,Turkey Bacon
Meat,MET0026,Beef Bacon
Meat,MET0027,Salami
Meat,MET0028,Pepperoni
Meat,MET0029,Beef Bone (Marrow)
Meat,MET0030,Chicken Stock Bone
Nuts,NUT0001,Cashew Nut
Nuts,NUT0002,Almond
Nuts,NUT0003,Walnut
Nuts,NUT0004,Pistachio
Nuts,NUT0005,Peanut (Raw)
Nuts,NUT0006,Peanut (Roasted)
Nuts,NUT0007,Pine Nut
Nuts,NUT0008,Sesame Seed (White)
Nuts,NUT0009,Sesame Seed (Black)
Nuts,NUT0010,Chia Seed
Nuts,NUT0011,Flax Seed
Nuts,NUT0012,Sunflower Seed
Nuts,NUT0013,Pumpkin Seed
Nuts,NUT0014,Macadamia Nut
Nuts,NUT0015,Desiccated Coconut
Oil,OIL0001,Soybean Oil
Oil,OIL0002,Sunflower Oil
Oil,OIL0003,Olive Oil (Extra Virgin)
Oil,OIL0004,Olive Oil (Pomace)
Oil,OIL0005,Sesame Oil
Oil,OIL0006,Coconut Oil
Oil,OIL0007,Canola Oil
Oil,OIL0008,Vegetable Oil
Oil,OIL0009,Mustard Oil
Oil,OIL0010,Rice Bran Oil
Oil,OIL0011,Truffle Oil
Oil,OIL0012,Avocado Oil
PASTE,PST0001,Ginger Paste
PASTE,PST0002,Garlic Paste
PASTE,PST0003,Ginger-Garlic Paste
PASTE,PST0004,Green Chilli Paste
PASTE,PST0005,Red Chilli Paste
PASTE,PST0006,Onion Paste
PASTE,PST0007,Tomato Paste
PASTE,PST0008,Curry Paste (Thai Red)
PASTE,PST0009,Curry Paste (Thai Green)
PASTE,PST0010,Miso Paste (White)
PASTE,PST0011,Miso Paste (Red)
PASTE,PST0012,Wasabi Paste
PASTE,PST0013,Sriracha Paste
PASTE,PST0014,Harissa Paste
PASTE,PST0015,Tahini
Packaged Food,PKG0001,Canned Tomato (Whole)
Packaged Food,PKG0002,Canned Tomato (Diced)
Packaged Food,PKG0003,Canned Tuna
Packaged Food,PKG0004,Canned Chickpea
Packaged Food,PKG0005,Canned Sweet Corn
Packaged Food,PKG0006,Canned Coconut Milk
Packaged Food,PKG0007,Canned Mushroom
Packaged Food,PKG0008,Canned Pineapple
Packaged Food,PKG0009,Dried Red Lentil (Masoor)
Packaged Food,PKG0010,Dried Green Lentil
Packaged Food,PKG0011,Dried Chickpea
Packaged Food,PKG0012,Dried Black Bean
Packaged Food,PKG0013,Dried Kidney Bean
Packaged Food,PKG0014,Nori Sheet (Seaweed)
Packaged Food,PKG0015,Tempura Batter Mix
Packaged Food,PKG0016,Gelatin Powder
Packaged Food,PKG0017,Agar Agar
Packaged Food,PKG0018,Baking Powder
Packaged Food,PKG0019,Baking Soda
Packaged Food,PKG0020,Yeast (Active Dry)
Packaged Food,PKG0021,Cornstarch
Packaged Food,PKG0022,Custard Powder
Packaged Food,PKG0023,Jelly Powder
Packaged Food,PKG0024,Marshmallow
Packaged Food,PKG0025,Graham Cracker
MIX,MIX0001,Tandoori Spice Mix
MIX,MIX0002,Biryani Masala Mix
MIX,MIX0003,Garam Masala Mix
MIX,MIX0004,Chat Masala Mix
MIX,MIX0005,Falafel Mix
MIX,MIX0006,Pancake Mix
MIX,MIX0007,Tempura Mix
MIX,MIX0008,Brownie Mix
MIX,MIX0009,Cake Mix (Vanilla)
MIX,MIX0010,Cake Mix (Chocolate)
Pickale,PKL0001,Mango Pickle
Pickale,PKL0002,Mixed Vegetable Pickle
Pickale,PKL0003,Olive (Green)
Pickale,PKL0004,Olive (Black)
Pickale,PKL0005,Jalapeno (Pickled)
Pickale,PKL0006,Gherkin (Pickle)
Pickale,PKL0007,Kimchi
Pickale,PKL0008,Capers
Pickale,PKL0009,Sun-dried Tomato
Pickale,PKL0010,Sauerkraut
Sauce,SAU0001,Soy Sauce
Sauce,SAU0002,Soy Sauce (Dark)
Sauce,SAU0003,Oyster Sauce
Sauce,SAU0004,Fish Sauce
Sauce,SAU0005,Hoisin Sauce
Sauce,SAU0006,Teriyaki Sauce
Sauce,SAU0007,Sweet Chilli Sauce
Sauce,SAU0008,Sriracha Sauce
Sauce,SAU0009,Tabasco Sauce
Sauce,SAU0010,Worcestershire Sauce
Sauce,SAU0011,Ketchup
Sauce,SAU0012,Mayonnaise
Sauce,SAU0013,Mustard (Yellow)
Sauce,SAU0014,Mustard (Dijon)
Sauce,SAU0015,BBQ Sauce
Sauce,SAU0016,Hot Sauce
Sauce,SAU0017,Tonkatsu Sauce
Sauce,SAU0018,Ponzu Sauce
Sauce,SAU0019,Ranch Dressing
Sauce,SAU0020,Caesar Dressing
Sauce,SAU0021,Thousand Island Dressing
Sauce,SAU0022,Chilli Garlic Sauce
Sauce,SAU0023,Peri Peri Sauce
Sauce,SAU0024,Sambal Oelek
Sauce,SAU0025,Unagi Sauce (Eel Sauce)
Spice,SPC0001,Salt
Spice,SPC0002,Black Pepper (Ground)
Spice,SPC0003,Black Pepper (Whole)
Spice,SPC0004,White Pepper
Spice,SPC0005,Turmeric Powder
Spice,SPC0006,Cumin Powder
Spice,SPC0007,Cumin Seed
Spice,SPC0008,Coriander Powder
Spice,SPC0009,Coriander Seed
Spice,SPC0010,Red Chilli Powder
Spice,SPC0011,Red Chilli Flakes
Spice,SPC0012,Paprika (Sweet)
Spice,SPC0013,Paprika (Smoked)
Spice,SPC0014,Cinnamon Stick
Spice,SPC0015,Cinnamon Powder
Spice,SPC0016,Cardamom (Green)
Spice,SPC0017,Cardamom (Black)
Spice,SPC0018,Clove
Spice,SPC0019,Star Anise
Spice,SPC0020,Bay Leaf
Spice,SPC0021,Nutmeg
Spice,SPC0022,Mace
Spice,SPC0023,Fenugreek Seed
Spice,SPC0024,Fennel Seed
Spice,SPC0025,Mustard Seed (Yellow)
Spice,SPC0026,Mustard Seed (Black)
Spice,SPC0027,Oregano (Dried)
Spice,SPC0028,Basil (Dried)
Spice,SPC0029,Thyme (Dried)
Spice,SPC0030,Rosemary (Dried)
Spice,SPC0031,Parsley (Dried)
Spice,SPC0032,Dill (Dried)
Spice,SPC0033,Saffron
Spice,SPC0034,Curry Powder
Spice,SPC0035,Five Spice Powder
Spice,SPC0036,Garlic Powder
Spice,SPC0037,Onion Powder
Spice,SPC0038,Cajun Seasoning
Spice,SPC0039,Italian Seasoning
Spice,SPC0040,Sumac
Service and Packaging,SRV0001,Paper Napkin
Service and Packaging,SRV0002,Tissue Box
Service and Packaging,SRV0003,Cling Wrap
Service and Packaging,SRV0004,Aluminium Foil
Service and Packaging,SRV0005,Plastic Wrap
Service and Packaging,SRV0006,Takeaway Box (Small)
Service and Packaging,SRV0007,Takeaway Box (Large)
Service and Packaging,SRV0008,Paper Bag (Small)
Service and Packaging,SRV0009,Paper Bag (Large)
Service and Packaging,SRV0010,Plastic Cup (16oz)
Service and Packaging,SRV0011,Paper Cup (Hot 12oz)
Service and Packaging,SRV0012,Straw (Paper)
Service and Packaging,SRV0013,Straw (Plastic)
Service and Packaging,SRV0014,Wooden Chopstick
Service and Packaging,SRV0015,Plastic Fork/Spoon Set
Service and Packaging,SRV0016,Sauce Container (Small)
Service and Packaging,SRV0017,Garbage Bag (Large)
Service and Packaging,SRV0018,Kitchen Towel Roll
Service and Packaging,SRV0019,Dish Soap
Service and Packaging,SRV0020,Sanitizer Spray
Service and Packaging,SRV0021,Hand Gloves (Box)
Service and Packaging,SRV0022,Chef Cap
Service and Packaging,SRV0023,Apron
Service and Packaging,SRV0024,Toothpick
Service and Packaging,SRV0025,Receipt Paper Roll
Syrup,SYR0001,Maple Syrup
Syrup,SYR0002,Honey
Syrup,SYR0003,Agave Syrup
Syrup,SYR0004,Date Syrup (Khejur Gur)
Syrup,SYR0005,Molasses
Syrup,SYR0006,Golden Syrup
Syrup,SYR0007,Corn Syrup
Syrup,SYR0008,Rose Syrup
Syrup,SYR0009,Grenadine Syrup
Syrup,SYR0010,Simple Syrup (Prepared)
Vegetables,VEG0001,Onion
Vegetables,VEG0002,Garlic (Whole)
Vegetables,VEG0003,Ginger (Fresh)
Vegetables,VEG0004,Potato
Vegetables,VEG0005,Tomato
Vegetables,VEG0006,Green Chilli
Vegetables,VEG0007,Red Chilli (Fresh)
Vegetables,VEG0008,Capsicum (Green)
Vegetables,VEG0009,Capsicum (Red)
Vegetables,VEG0010,Capsicum (Yellow)
Vegetables,VEG0011,Carrot
Vegetables,VEG0012,Cucumber
Vegetables,VEG0013,Lettuce (Iceberg)
Vegetables,VEG0014,Lettuce (Romaine)
Vegetables,VEG0015,Spinach
Vegetables,VEG0016,Broccoli
Vegetables,VEG0017,Cauliflower
Vegetables,VEG0018,Cabbage (Green)
Vegetables,VEG0019,Cabbage (Purple)
Vegetables,VEG0020,Bean Sprout
Vegetables,VEG0021,Spring Onion
Vegetables,VEG0022,Lemon
Vegetables,VEG0023,Lime
Vegetables,VEG0024,Coriander Leaf (Fresh)
Vegetables,VEG0025,Mint Leaf (Fresh)
Vegetables,VEG0026,Basil (Fresh)
Vegetables,VEG0027,Thai Basil
Vegetables,VEG0028,Lemongrass
Vegetables,VEG0029,Galangal
Vegetables,VEG0030,Kaffir Lime Leaf
Vegetables,VEG0031,Mushroom (Button)
Vegetables,VEG0032,Mushroom (Shiitake)
Vegetables,VEG0033,Mushroom (Oyster)
Vegetables,VEG0034,Mushroom (Enoki)
Vegetables,VEG0035,Eggplant (Aubergine)
Vegetables,VEG0036,Zucchini
Vegetables,VEG0037,Corn on the Cob
Vegetables,VEG0038,Avocado
Vegetables,VEG0039,Celery
Vegetables,VEG0040,Leek
Vegetables,VEG0041,Radish (White/Daikon)
Vegetables,VEG0042,Bamboo Shoot
Vegetables,VEG0043,Water Chestnut
Vegetables,VEG0044,Baby Bok Choy
Vegetables,VEG0045,Snow Peas
Vegetables,VEG0046,Green Beans
Vegetables,VEG0047,Asparagus
Vegetables,VEG0048,Beetroot
Vegetables,VEG0049,Sweet Potato
Vegetables,VEG0050,Pumpkin
Vegetables,VEG0051,Banana (Ripe)
Vegetables,VEG0052,Mango (Fresh)
Vegetables,VEG0053,Pineapple (Fresh)
Vegetables,VEG0054,Papaya
Vegetables,VEG0055,Watermelon
Vegetables,VEG0056,Strawberry (Fresh)
Vegetables,VEG0057,Blueberry (Fresh)
Vegetables,VEG0058,Orange
Vegetables,VEG0059,Apple (Green)
Vegetables,VEG0060,Passion Fruit
c,OIL0013,Cooking Spray`);

// ── Menu Data (parsed from restaurant CSV export) ───────────────────────────

const MENU_DATA = parseMenuCSV(`Dimsum,Appetizer,Main Kitchen,Chicken Dimsum,Steamed chicken dumplings,Active,1 Serving,320
Dimsum,Appetizer,Main Kitchen,Prawn Har Gow,Crystal shrimp dumplings,Active,1 Serving,380
Dimsum,Appetizer,Main Kitchen,Vegetable Dimsum,Mixed vegetable steamed dumplings,Active,1 Serving,280
Dimsum,Appetizer,Main Kitchen,Pork Siu Mai,Traditional pork and shrimp siu mai,Active,1 Serving,350
Dimsum,Appetizer,Main Kitchen,Mushroom Crystal Dumpling,Shiitake mushroom in rice flour wrapper,Active,1 Serving,300
Seafood,Appetizer,Main Kitchen,Prawn Tempura,Crispy battered tiger prawns (5pcs),Active,1 Serving,450
Seafood,Appetizer,Main Kitchen,Calamari Rings,Golden fried squid rings with aioli,Active,1 Serving,380
Seafood,Appetizer,Main Kitchen,Shrimp Toast,Minced shrimp on crispy bread,Active,1 Serving,320
Seafood,Appetizer,Main Kitchen,Crab Rangoon,Cream cheese and crab wonton,Active,1 Serving,350
Seafood,Appetizer,Main Kitchen,Tuna Tataki,Seared tuna with ponzu dressing,Active,1 Serving,520
Chef's Special -Appetizer,Appetizer,Main Kitchen,Chicken Satay,Grilled chicken skewers with peanut sauce,Active,4 Pcs,420
Chef's Special -Appetizer,Appetizer,Main Kitchen,Spring Roll (Veg),Crispy vegetable spring rolls (4pcs),Active,4 Pcs,250
Chef's Special -Appetizer,Appetizer,Main Kitchen,Spring Roll (Chicken),Crispy chicken spring rolls (4pcs),Active,4 Pcs,300
Chef's Special -Appetizer,Appetizer,Main Kitchen,Dynamite Shrimp,Spicy battered shrimp with mayo,Active,1 Serving,480
Chef's Special -Appetizer,Appetizer,Main Kitchen,Edamame Salt & Pepper,Salted steamed edamame beans,Active,1 Serving,220
Sushi,Sushi,Main Kitchen,Salmon Nigiri,Fresh salmon on sushi rice (2pcs),Active,2 Pcs,350
Sushi,Sushi,Main Kitchen,Tuna Nigiri,Fresh tuna on sushi rice (2pcs),Active,2 Pcs,380
Sushi,Sushi,Main Kitchen,Prawn Nigiri,Cooked prawn on sushi rice (2pcs),Active,2 Pcs,320
Sushi,Sushi,Main Kitchen,California Roll,Crab surimi avocado cucumber (8pcs),Active,8 Pcs,420
Sushi,Sushi,Main Kitchen,Spicy Tuna Roll,Spicy tuna with sriracha mayo (8pcs),Active,8 Pcs,480
Sushi,Sushi,Main Kitchen,Dragon Roll,Eel avocado topped with tobiko (8pcs),Active,8 Pcs,550
Sushi,Sushi,Main Kitchen,Salmon Sashimi,Fresh sliced salmon (5pcs),Active,5 Pcs,520
Sushi,Sushi,Main Kitchen,Tuna Sashimi,Fresh sliced tuna (5pcs),Active,5 Pcs,550
Sushi,Sushi,Main Kitchen,Rainbow Roll,Assorted fish on California roll (8pcs),Active,8 Pcs,620
Sushi,Sushi,Main Kitchen,Vegetable Roll,Cucumber avocado carrot (8pcs),Active,8 Pcs,300
Soup,Soup,Main Kitchen,Tom Yum Goong,Spicy Thai prawn soup with lemongrass,Active,1 Bowl,350
Soup,Soup,Main Kitchen,Tom Kha Gai,Thai coconut chicken soup,Active,1 Bowl,320
Soup,Soup,Main Kitchen,Miso Soup,Traditional Japanese soybean soup,Active,1 Bowl,180
Soup,Soup,Main Kitchen,Hot & Sour Soup,Chinese style with tofu and mushroom,Active,1 Bowl,250
Soup,Soup,Main Kitchen,Wonton Soup,Pork wontons in clear broth,Active,1 Bowl,280
Soup,Soup,Main Kitchen,Cream of Mushroom,Creamy wild mushroom soup,Active,1 Bowl,280
Soup,Soup,Main Kitchen,Chicken Corn Soup,Egg drop chicken corn soup,Active,1 Bowl,240
Salad,Salad,Main Kitchen,Caesar Salad,Romaine with parmesan croutons caesar dressing,Active,1 Serving,350
Salad,Salad,Main Kitchen,Thai Papaya Salad,Green papaya with chilli lime dressing,Active,1 Serving,280
Salad,Salad,Main Kitchen,Grilled Chicken Salad,Mixed greens with grilled chicken breast,Active,1 Serving,420
Salad,Salad,Main Kitchen,Tuna Salad,Seared tuna on mixed greens,Active,1 Serving,480
Salad,Salad,Main Kitchen,Seaweed Salad,Wakame seaweed with sesame dressing,Active,1 Serving,250
Rice,Rice,Main Kitchen,Steamed Jasmine Rice,Fragrant Thai jasmine rice,Active,1 Serving,120
Rice,Rice,Main Kitchen,Egg Fried Rice,Wok-fried rice with egg and vegetables,Active,1 Serving,220
Rice,Rice,Main Kitchen,Chicken Fried Rice,Fried rice with diced chicken,Active,1 Serving,320
Rice,Rice,Main Kitchen,Prawn Fried Rice,Fried rice with juicy prawns,Active,1 Serving,380
Rice,Rice,Main Kitchen,Thai Basil Fried Rice,Spicy basil fried rice with chicken,Active,1 Serving,350
Rice,Rice,Main Kitchen,Nasi Goreng,Indonesian style fried rice,Active,1 Serving,350
Rice,Rice,Main Kitchen,Biryani (Chicken),Aromatic basmati chicken biryani,Active,1 Serving,450
Rice,Rice,Main Kitchen,Biryani (Mutton),Slow-cooked mutton biryani,Active,1 Serving,550
Rice,Rice,Main Kitchen,Biryani (Prawn),Fragrant prawn biryani,Active,1 Serving,520
Rice,Rice,Main Kitchen,Sticky Rice,Thai sticky rice,Active,1 Serving,100
Noodles,Noodles,Main Kitchen,Pad Thai (Chicken),Classic Thai stir-fried noodles with chicken,Active,1 Serving,380
Noodles,Noodles,Main Kitchen,Pad Thai (Prawn),Classic Thai stir-fried noodles with prawn,Active,1 Serving,420
Noodles,Noodles,Main Kitchen,Hakka Noodles,Indo-Chinese stir-fried noodles,Active,1 Serving,300
Noodles,Noodles,Main Kitchen,Chow Mein (Chicken),Crispy noodles with chicken stir-fry,Active,1 Serving,350
Noodles,Noodles,Main Kitchen,Chow Mein (Prawn),Crispy noodles with prawn stir-fry,Active,1 Serving,400
Noodles,Noodles,Main Kitchen,Ramen (Tonkotsu),Rich pork bone broth ramen,Active,1 Bowl,480
Noodles,Noodles,Main Kitchen,Ramen (Shoyu),Soy sauce based chicken ramen,Active,1 Bowl,450
Noodles,Noodles,Main Kitchen,Singapore Noodles,Curry-flavored rice vermicelli,Active,1 Serving,380
Noodles,Noodles,Main Kitchen,Yakisoba,Japanese stir-fried noodles,Active,1 Serving,350
Noodles,Noodles,Main Kitchen,Udon Noodle Soup,Thick udon in dashi broth,Active,1 Bowl,380
Chicken & Beef,Curries,Main Kitchen,Butter Chicken,Creamy tomato-based chicken curry,Active,1 Serving,420
Chicken & Beef,Curries,Main Kitchen,Thai Green Curry (Chicken),Coconut green curry with chicken,Active,1 Serving,400
Chicken & Beef,Curries,Main Kitchen,Thai Red Curry (Chicken),Spicy red curry with chicken,Active,1 Serving,400
Chicken & Beef,Curries,Main Kitchen,Chicken Teriyaki,Grilled chicken with teriyaki glaze,Active,1 Serving,380
Chicken & Beef,Curries,Main Kitchen,Beef Rendang,Slow-cooked dry beef curry,Active,1 Serving,520
Chicken & Beef,Curries,Main Kitchen,Beef Bulgogi,Korean marinated beef,Active,1 Serving,480
Chicken & Beef,Curries,Main Kitchen,Chicken Katsu Curry,Crispy chicken cutlet with Japanese curry,Active,1 Serving,450
Chicken & Beef,Curries,Main Kitchen,Massaman Curry (Beef),Thai peanut curry with tender beef,Active,1 Serving,500
Seafood & Vegetable,Curries,Main Kitchen,Prawn Massaman,Massaman curry with tiger prawns,Active,1 Serving,520
Seafood & Vegetable,Curries,Main Kitchen,Fish Curry (Bengali),Traditional Bengali fish curry,Active,1 Serving,420
Seafood & Vegetable,Curries,Main Kitchen,Thai Green Curry (Prawn),Coconut green curry with prawns,Active,1 Serving,480
Seafood & Vegetable,Curries,Main Kitchen,Vegetable Thai Curry,Mixed vegetable in coconut curry,Active,1 Serving,350
Seafood & Vegetable,Curries,Main Kitchen,Paneer Butter Masala,Paneer in rich tomato gravy,Active,1 Serving,380
Seafood & Vegetable,Curries,Main Kitchen,Tofu Teriyaki,Grilled tofu with teriyaki sauce,Active,1 Serving,320
Captain's Cuts,EATRO's Special,Main Kitchen,Grilled Salmon Steak,Atlantic salmon with herb butter,Active,1 Serving,850
Captain's Cuts,EATRO's Special,Main Kitchen,Grilled Sea Bass,Whole sea bass with lemon butter,Active,1 Serving,780
Captain's Cuts,EATRO's Special,Main Kitchen,Lobster Tail Grilled,Grilled lobster tail with garlic butter,Active,1 Serving,1200
Captain's Cuts,EATRO's Special,Main Kitchen,Beef Steak (Ribeye),8oz ribeye with pepper sauce,Active,8oz,950
Captain's Cuts,EATRO's Special,Main Kitchen,Beef Steak (Tenderloin),6oz tenderloin with mushroom sauce,Active,6oz,1100
Captain's Cuts,EATRO's Special,Main Kitchen,Lamb Chop,Grilled lamb chops with mint sauce,Active,1 Serving,880
Straw-Hat Style,EATRO's Special,Main Kitchen,EATRO Signature Platter,Assorted grills and seafood for 2,Active,For 2,1500
Straw-Hat Style,EATRO's Special,Main Kitchen,Seafood Paella,Spanish saffron rice with mixed seafood,Active,1 Serving,780
Straw-Hat Style,EATRO's Special,Main Kitchen,Teppanyaki Mixed Grill,Japanese iron plate grilled selection,Active,1 Serving,920
Straw-Hat Style,EATRO's Special,Main Kitchen,Sizzling Beef Fajita,Tex-Mex style with peppers and onions,Active,1 Serving,650
Handcraft Ice Creams,Dessert,Main Kitchen,Vanilla Bean Ice Cream,Classic vanilla with real bean,Active,1 Scoop,150
Handcraft Ice Creams,Dessert,Main Kitchen,Chocolate Fudge Ice Cream,Rich dark chocolate fudge,Active,1 Scoop,150
Handcraft Ice Creams,Dessert,Main Kitchen,Mango Sorbet,Fresh mango fruit sorbet,Active,1 Scoop,150
Handcraft Ice Creams,Dessert,Main Kitchen,Matcha Ice Cream,Japanese green tea ice cream,Active,1 Scoop,180
Handcraft Ice Creams,Dessert,Main Kitchen,Pistachio Ice Cream,Creamy pistachio with nuts,Active,1 Scoop,180
Handcraft Ice Creams,Dessert,Main Kitchen,Salted Caramel Ice Cream,Sea salt caramel swirl,Active,1 Scoop,180
EATRO's Special Dessert,Dessert,Main Kitchen,Molten Lava Cake,Warm chocolate cake with liquid center,Active,1 Serving,350
EATRO's Special Dessert,Dessert,Main Kitchen,Tiramisu,Classic Italian coffee dessert,Active,1 Serving,320
EATRO's Special Dessert,Dessert,Main Kitchen,Mango Sticky Rice,Thai sweet sticky rice with mango,Active,1 Serving,280
EATRO's Special Dessert,Dessert,Main Kitchen,Creme Brulee,French vanilla custard with caramel top,Active,1 Serving,300
EATRO's Special Dessert,Dessert,Main Kitchen,Banana Tempura,Fried banana with ice cream,Active,1 Serving,280
EATRO's Special Dessert,Dessert,Main Kitchen,Cheesecake (New York),Classic baked cheesecake,Active,1 Slice,320
Platter,Platter,Main Kitchen,Mixed Sushi Platter,24pc assorted sushi and sashimi,Active,For 2,1200
Platter,Platter,Main Kitchen,Dimsum Platter,12pc assorted steamed and fried dimsum,Active,For 2,680
Platter,Platter,Main Kitchen,Appetizer Platter,Selection of 4 appetizers,Active,For 2,750
Platter,Platter,Main Kitchen,Dessert Platter,Assorted mini desserts for sharing,Active,For 2,550
Bowls Menu,Bowls,Main Kitchen,Poke Bowl (Salmon),Fresh salmon avocado edamame on rice,Active,1 Bowl,480
Bowls Menu,Bowls,Main Kitchen,Poke Bowl (Tuna),Fresh tuna with mango on rice,Active,1 Bowl,500
Bowls Menu,Bowls,Main Kitchen,Chicken Teriyaki Bowl,Grilled chicken teriyaki on rice,Active,1 Bowl,380
Bowls Menu,Bowls,Main Kitchen,Korean Bibimbap,Rice with vegetables egg and gochujang,Active,1 Bowl,400
Bowls Menu,Bowls,Main Kitchen,Katsu Don,Chicken katsu egg on rice,Active,1 Bowl,380
Bowls Menu,Bowls,Main Kitchen,Buddha Bowl,Quinoa roasted veg hummus bowl,Active,1 Bowl,420
Fresh Juice,Drinks,Barista,Orange Juice,Fresh squeezed orange juice,Active,1 Glass,250
Fresh Juice,Drinks,Barista,Watermelon Juice,Fresh watermelon juice,Active,1 Glass,200
Fresh Juice,Drinks,Barista,Pineapple Juice,Fresh pineapple juice,Active,1 Glass,220
Fresh Juice,Drinks,Barista,Mango Juice,Fresh mango pulp juice,Active,1 Glass,250
Fresh Juice,Drinks,Barista,Mixed Fruit Juice,Seasonal mixed fruit blend,Active,1 Glass,280
Fizz & Sparkle,Drinks,Barista,Coca Cola,Classic Coca Cola 250ml,Active,250ml,80
Fizz & Sparkle,Drinks,Barista,Sprite,Sprite 250ml,Active,250ml,80
Fizz & Sparkle,Drinks,Barista,Fanta,Fanta Orange 250ml,Active,250ml,80
Fizz & Sparkle,Drinks,Barista,Red Bull,Energy drink,Active,250ml,250
Fizz & Sparkle,Drinks,Barista,Sparkling Water,San Pellegrino,Active,250ml,150
Tea Time Refreshers,Drinks,Barista,Green Tea,Japanese green tea,Active,1 Cup,120
Tea Time Refreshers,Drinks,Barista,Jasmine Tea,Fragrant jasmine tea,Active,1 Cup,120
Tea Time Refreshers,Drinks,Barista,Chamomile Tea,Calming chamomile herbal tea,Active,1 Cup,130
Tea Time Refreshers,Drinks,Barista,Masala Chai,Indian spiced milk tea,Active,1 Cup,150
Tea Time Refreshers,Drinks,Barista,Iced Tea (Lemon),Refreshing lemon iced tea,Active,1 Glass,150
Tea Time Refreshers,Drinks,Barista,Iced Tea (Peach),Peach flavored iced tea,Active,1 Glass,150
Lemonades,Drinks,Barista,Classic Lemonade,Fresh lemon with sugar,Active,1 Glass,180
Lemonades,Drinks,Barista,Mint Lemonade,Lemon with fresh mint,Active,1 Glass,200
Lemonades,Drinks,Barista,Strawberry Lemonade,Lemon with strawberry puree,Active,1 Glass,220
Lemonades,Drinks,Barista,Passion Fruit Lemonade,Lemon with passion fruit,Active,1 Glass,220
Lemonades,Drinks,Barista,Blue Lagoon,Blue curacao lemonade,Active,1 Glass,250
Eatro's Special Drinks,Drinks,Barista,EATRO Sunset,Mango passion fruit layered drink,Active,1 Glass,320
Eatro's Special Drinks,Drinks,Barista,Ocean Breeze,Blue curacao coconut soda,Active,1 Glass,300
Eatro's Special Drinks,Drinks,Barista,Berry Blast,Mixed berry smoothie,Active,1 Glass,280
Eatro's Special Drinks,Drinks,Barista,Tropical Storm,Pineapple coconut lime blend,Active,1 Glass,300
Milkshakes,Drinks,Barista,Chocolate Milkshake,Rich chocolate milkshake,Active,1 Glass,280
Milkshakes,Drinks,Barista,Vanilla Milkshake,Classic vanilla milkshake,Active,1 Glass,250
Milkshakes,Drinks,Barista,Strawberry Milkshake,Fresh strawberry milkshake,Active,1 Glass,280
Milkshakes,Drinks,Barista,Oreo Milkshake,Cookies and cream milkshake,Active,1 Glass,300
Milkshakes,Drinks,Barista,Nutella Milkshake,Hazelnut chocolate milkshake,Active,1 Glass,320
Milkshakes,Drinks,Barista,Snickers Milkshake,Peanut caramel chocolate shake,Active,1 Glass,350
Espresso Drinks,Coffee,Barista,Espresso,Single shot espresso,Active,Single,150
Espresso Drinks,Coffee,Barista,Double Espresso,Double shot espresso,Active,Double,200
Espresso Drinks,Coffee,Barista,Americano,Espresso with hot water,Active,Regular,180
Espresso Drinks,Coffee,Barista,Cappuccino,Espresso with steamed milk foam,Active,Regular,220
Espresso Drinks,Coffee,Barista,Latte,Espresso with steamed milk,Active,Regular,250
Espresso Drinks,Coffee,Barista,Flat White,Double espresso with micro-foam milk,Active,Regular,250
Espresso Drinks,Coffee,Barista,Mocha,Espresso chocolate and steamed milk,Active,Regular,280
Espresso Drinks,Coffee,Barista,Caramel Macchiato,Vanilla latte with caramel drizzle,Active,Regular,300
Espresso Drinks,Coffee,Barista,Hazelnut Latte,Latte with hazelnut syrup,Active,Regular,280
Espresso Drinks,Coffee,Barista,Iced Americano,Cold espresso with water and ice,Active,Regular,200
Espresso Drinks,Coffee,Barista,Iced Latte,Espresso with cold milk over ice,Active,Regular,270
Espresso Drinks,Coffee,Barista,Iced Mocha,Cold chocolate espresso with milk,Active,Regular,300
Blended Frozen Drinks,Coffee,Barista,Mocha Frappe,Blended iced mocha with whipped cream,Active,Regular,350
Blended Frozen Drinks,Coffee,Barista,Caramel Frappe,Blended caramel coffee with cream,Active,Regular,350
Blended Frozen Drinks,Coffee,Barista,Vanilla Frappe,Blended vanilla coffee with cream,Active,Regular,330
Blended Frozen Drinks,Coffee,Barista,Java Chip Frappe,Coffee with chocolate chips blended,Active,Regular,380
Blended Frozen Drinks,Coffee,Barista,Matcha Frappe,Green tea blended with milk and ice,Active,Regular,350
Sauces,Add-ons,Main Kitchen,Extra Soy Sauce,Small portion soy sauce,Active,1 Portion,20
Sauces,Add-ons,Main Kitchen,Extra Chilli Sauce,Small portion chilli sauce,Active,1 Portion,20
Sauces,Add-ons,Main Kitchen,Extra Mayo,Small portion mayonnaise,Active,1 Portion,30
Sauces,Add-ons,Main Kitchen,Wasabi Extra,Extra wasabi paste,Active,1 Portion,30
Sauces,Add-ons,Main Kitchen,Pickled Ginger,Extra pickled ginger,Active,1 Portion,30
Sauces,Add-ons,Main Kitchen,Extra Rice,Additional steamed rice,Active,1 Serving,80
Sauces,Add-ons,Main Kitchen,Extra Naan,Butter naan bread,Active,1 Pc,60
Iftaar Platter,RAMADAN,Main Kitchen,Iftaar Box A,Dates samosa juice chicken roll,Active,1 Box,450
Iftaar Platter,RAMADAN,Main Kitchen,Iftaar Box B,Dates chola piyaju beguni halim,Active,1 Box,380
Iftaar Platter,RAMADAN,Main Kitchen,Premium Iftaar Box,Full spread with jilapi halim kebab,Active,1 Box,650
Iftaar Platter,RAMADAN,Main Kitchen,Halim,Traditional Dhaka-style halim,Active,1 Bowl,250
Iftaar Platter,RAMADAN,Main Kitchen,Chicken Kebab Platter,Assorted grilled chicken kebabs,Active,1 Platter,480`);

// ── Category Mappers ────────────────────────────────────────────────────────

function mapIngredientCategory(csvCategory: string): IngredientCategory {
  const map: Record<string, IngredientCategory> = {
    Bakery: 'PACKAGED',
    'Coffee & Drinks': 'BEVERAGE',
    Dairy: 'DAIRY',
    Drinks: 'BEVERAGE',
    Fish: 'RAW',
    Frozen: 'PACKAGED',
    Grain: 'RAW',
    'Ice Cream': 'PACKAGED',
    'Juice & Vinager': 'BEVERAGE',
    Meat: 'RAW',
    Nuts: 'RAW',
    Oil: 'RAW',
    PASTE: 'SPICE',
    'Packaged Food': 'PACKAGED',
    MIX: 'OTHER',
    Pickale: 'PACKAGED',
    Sauce: 'PACKAGED',
    Spice: 'SPICE',
    'Service and Packaging': 'CLEANING',
    Syrup: 'BEVERAGE',
    Vegetables: 'RAW',
    c: 'RAW',
  };
  return map[csvCategory] ?? 'OTHER';
}

function mapUnit(csvCategory: string): StockUnit {
  const map: Record<string, StockUnit> = {
    Meat: 'KG',
    Fish: 'KG',
    Vegetables: 'KG',
    Grain: 'KG',
    Nuts: 'KG',
    Oil: 'L',
    Dairy: 'PCS',
    Sauce: 'PCS',
    Syrup: 'L',
    Spice: 'G',
    PASTE: 'G',
    Drinks: 'PCS',
    'Coffee & Drinks': 'PCS',
    'Packaged Food': 'PCS',
    Bakery: 'PCS',
    Frozen: 'PCS',
    'Ice Cream': 'PCS',
    'Service and Packaging': 'PCS',
    MIX: 'KG',
    'Juice & Vinager': 'PCS',
    Pickale: 'PCS',
    c: 'L',
  };
  return map[csvCategory] ?? 'PCS';
}

// ── Main Seed Function ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.warn('🌱 Seeding Restora POS database with full production data…\n');

  // ── Branch ──────────────────────────────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { id: 'branch-main' },
    update: {
      name: 'EATRO Restaurant',
      address: 'Dhaka, Bangladesh',
      phone: '+880 1700 000000',
    },
    create: {
      id: 'branch-main',
      name: 'EATRO Restaurant',
      address: 'Dhaka, Bangladesh',
      phone: '+880 1700 000000',
      email: 'info@eatro.restaurant',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
      taxRate: 5,
    },
  });
  console.warn(`✅ Branch: ${branch.name}`);

  // ── Staff ───────────────────────────────────────────────────────────────────
  const staffData = [
    {
      id: 'staff-owner',
      name: 'Admin Owner',
      email: 'owner@restora.app',
      role: UserRole.OWNER,
      monthlySalary: 5000000,
    },
    {
      id: 'staff-manager',
      name: 'Sara Manager',
      email: 'manager@restora.app',
      role: UserRole.MANAGER,
      monthlySalary: 3500000,
    },
    {
      id: 'staff-cashier',
      name: 'Karim Cashier',
      email: 'cashier@restora.app',
      role: UserRole.CASHIER,
      monthlySalary: 2000000,
    },
    {
      id: 'staff-kitchen',
      name: 'Chef Rahman',
      email: 'kitchen@restora.app',
      role: UserRole.KITCHEN,
      monthlySalary: 2500000,
    },
    {
      id: 'staff-kitchen2',
      name: 'Chef Barista Nadia',
      email: 'barista@restora.app',
      role: UserRole.KITCHEN,
      monthlySalary: 2200000,
    },
    {
      id: 'staff-waiter',
      name: 'Rahim Waiter',
      email: 'waiter@restora.app',
      role: UserRole.WAITER,
      monthlySalary: 1500000,
    },
  ];

  const passwordHash = await bcrypt.hash('password123', 12);
  for (const s of staffData) {
    await prisma.staff.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, passwordHash, branchId: branch.id },
    });
    console.warn(`✅ Staff: ${s.name} (${s.role})`);
  }

  // ── Tables ──────────────────────────────────────────────────────────────────
  const tables = Array.from({ length: 10 }, (_, i) => ({
    tableNumber: `T${String(i + 1).padStart(2, '0')}`,
    capacity: i < 4 ? 4 : i < 7 ? 6 : i < 9 ? 2 : 8,
  }));

  for (const t of tables) {
    await prisma.diningTable.upsert({
      where: {
        branchId_tableNumber: {
          branchId: branch.id,
          tableNumber: t.tableNumber,
        },
      },
      update: {},
      create: { ...t, branchId: branch.id },
    });
  }
  console.warn(`✅ ${tables.length} dining tables`);

  // ── Suppliers ───────────────────────────────────────────────────────────────
  const suppliers = [
    {
      id: 'sup-meat',
      name: 'Dhaka Fresh Meats',
      category: 'MEAT' as SupplierCategory,
      contactName: 'Abdul Karim',
      phone: '+880 1711 111111',
    },
    {
      id: 'sup-fish',
      name: 'Bay of Bengal Seafood',
      category: 'FISH' as SupplierCategory,
      contactName: 'Rafiq Uddin',
      phone: '+880 1722 222222',
    },
    {
      id: 'sup-veg',
      name: 'Green Valley Farms',
      category: 'VEGETABLES' as SupplierCategory,
      contactName: 'Shamima Begum',
      phone: '+880 1733 333333',
    },
    {
      id: 'sup-dairy',
      name: 'Pran Dairy',
      category: 'DAIRY' as SupplierCategory,
      contactName: 'Hasan Ali',
      phone: '+880 1744 444444',
    },
    {
      id: 'sup-general',
      name: 'Agora Wholesale',
      category: 'GENERAL' as SupplierCategory,
      contactName: 'Nasir Uddin',
      phone: '+880 1755 555555',
    },
  ];

  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { id: s.id },
      update: {},
      create: { ...s, branchId: branch.id },
    });
  }
  console.warn(`✅ ${suppliers.length} suppliers`);

  // ── Inventory (Ingredients) ─────────────────────────────────────────────────
  const categoryToSupplier: Record<string, string> = {
    Meat: 'sup-meat',
    Fish: 'sup-fish',
    Frozen: 'sup-meat',
    Vegetables: 'sup-veg',
    Dairy: 'sup-dairy',
    'Ice Cream': 'sup-dairy',
    Spice: 'sup-general',
    Grain: 'sup-general',
    Oil: 'sup-general',
    Sauce: 'sup-general',
    PASTE: 'sup-general',
    'Packaged Food': 'sup-general',
    Bakery: 'sup-general',
    'Coffee & Drinks': 'sup-general',
    'Service and Packaging': 'sup-general',
    Drinks: 'sup-general',
    Nuts: 'sup-general',
    Syrup: 'sup-general',
    'Juice & Vinager': 'sup-general',
    MIX: 'sup-general',
    Pickale: 'sup-general',
    c: 'sup-general',
  };

  // Deterministic "random" stock and cost values based on item code
  function seedRandom(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) & 0x7fffffff;
    }
    return (hash % 1000) / 1000;
  }

  let ingCount = 0;
  for (const item of INVENTORY_DATA) {
    const existing = await prisma.ingredient.findFirst({
      where: { branchId: branch.id, itemCode: item.code },
    });
    if (!existing) {
      const r = seedRandom(item.code);
      await prisma.ingredient.create({
        data: {
          branchId: branch.id,
          name: item.name,
          itemCode: item.code,
          category: mapIngredientCategory(item.category),
          unit: mapUnit(item.category),
          currentStock: Math.floor(r * 50) + 5,
          minimumStock: 5,
          costPerUnit: Math.floor(r * 5000) + 500,
          supplierId: categoryToSupplier[item.category] ?? null,
        },
      });
      ingCount++;
    }
  }
  console.warn(`✅ ${ingCount} inventory ingredients imported`);

  // ── Menu Categories & Items ─────────────────────────────────────────────────
  const parentCats = [
    'Appetizer',
    'Sushi',
    'Soup',
    'Salad',
    'Rice',
    'Noodles',
    'Curries',
    "EATRO's Special",
    'Dessert',
    'Platter',
    'Bowls',
    'Drinks',
    'Coffee',
    'Add-ons',
    'RAMADAN',
  ];
  const catMap: Record<string, string> = {};

  let sortOrder = 1;
  for (const catName of parentCats) {
    const catId = `cat-${catName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const cat = await prisma.menuCategory.upsert({
      where: { id: catId },
      update: { name: catName, sortOrder },
      create: { id: catId, branchId: branch.id, name: catName, sortOrder },
    });
    catMap[catName] = cat.id;
    sortOrder++;
  }

  // Sub-categories
  const subCats: { name: string; parent: string }[] = [
    { name: 'Dimsum', parent: 'Appetizer' },
    { name: 'Seafood', parent: 'Appetizer' },
    { name: "Chef's Special", parent: 'Appetizer' },
    { name: 'Chicken & Beef', parent: 'Curries' },
    { name: 'Seafood & Vegetable', parent: 'Curries' },
    { name: "Captain's Cuts", parent: "EATRO's Special" },
    { name: 'Straw-Hat Style', parent: "EATRO's Special" },
    { name: 'Handcraft Ice Creams', parent: 'Dessert' },
    { name: "EATRO's Dessert", parent: 'Dessert' },
    { name: 'Bowls Menu', parent: 'Bowls' },
    { name: 'Fresh Juice', parent: 'Drinks' },
    { name: 'Fizz & Sparkle', parent: 'Drinks' },
    { name: 'Tea Time Refreshers', parent: 'Drinks' },
    { name: 'Lemonades', parent: 'Drinks' },
    { name: "Eatro's Special Drinks", parent: 'Drinks' },
    { name: 'Milkshakes', parent: 'Drinks' },
    { name: 'Espresso Drinks', parent: 'Coffee' },
    { name: 'Blended Frozen Drinks', parent: 'Coffee' },
    { name: 'Sauces', parent: 'Add-ons' },
    { name: 'Iftaar Platter', parent: 'RAMADAN' },
  ];

  for (const sc of subCats) {
    const scId = `cat-${sc.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const parentId = catMap[sc.parent];
    const cat = await prisma.menuCategory.upsert({
      where: { id: scId },
      update: { name: sc.name, parentId, sortOrder },
      create: {
        id: scId,
        branchId: branch.id,
        name: sc.name,
        parentId,
        sortOrder,
      },
    });
    catMap[sc.name] = cat.id;
    sortOrder++;
  }
  console.warn(
    `✅ ${parentCats.length} parent + ${subCats.length} sub-categories`,
  );

  // ── Menu Items ──────────────────────────────────────────────────────────────
  const csvCatMapping: Record<string, string> = {
    Dimsum: 'Dimsum',
    Seafood: 'Seafood',
    "Chef's Special -Appetizer": "Chef's Special",
    "Chef\u2019s Special -Appetizer": "Chef's Special",
    'Chicken & Beef': 'Chicken & Beef',
    'Seafood & Vegetable': 'Seafood & Vegetable',
    "Captain's Cuts": "Captain's Cuts",
    "Captain\u2019s Cuts": "Captain's Cuts",
    'Straw-Hat Style': 'Straw-Hat Style',
    'Handcraft Ice Creams': 'Handcraft Ice Creams',
    "EATRO's Special Dessert": "EATRO's Dessert",
    "EATRO\u2019s Special Dessert": "EATRO's Dessert",
    'Bowls Menu': 'Bowls Menu',
    'Fresh Juice': 'Fresh Juice',
    'Fizz & Sparkle': 'Fizz & Sparkle',
    'Tea Time Refreshers': 'Tea Time Refreshers',
    Lemonades: 'Lemonades',
    "Eatro's Special Drinks": "Eatro's Special Drinks",
    "Eatro\u2019s Special Drinks": "Eatro's Special Drinks",
    Milkshakes: 'Milkshakes',
    'Espresso Drinks': 'Espresso Drinks',
    'Blended Frozen Drinks': 'Blended Frozen Drinks',
    Sauces: 'Sauces',
    'Iftaar Platter': 'Iftaar Platter',
    // Parent categories that appear directly as sub-category in CSV
    Sushi: 'Sushi',
    Soup: 'Soup',
    Salad: 'Salad',
    Rice: 'Rice',
    Noodles: 'Noodles',
    Platter: 'Platter',
  };

  let menuCount = 0;
  for (const item of MENU_DATA) {
    // Determine category: use sub-category if exists, otherwise parent
    const categoryKey = item.subCategory
      ? (csvCatMapping[item.subCategory] ?? item.subCategory)
      : item.parentCategory;
    let categoryId = catMap[categoryKey];
    if (!categoryId) {
      // Try parent category
      categoryId = catMap[item.parentCategory];
    }
    if (!categoryId) {
      categoryId = catMap['Add-ons'];
    }
    if (!categoryId) continue;

    const fullName =
      item.variant && item.variant !== '1 Serving'
        ? `${item.name} (${item.variant})`
        : item.name;

    const existing = await prisma.menuItem.findFirst({
      where: { branchId: branch.id, name: fullName },
    });
    if (!existing) {
      const type =
        item.parentCategory === 'Coffee' || item.parentCategory === 'Drinks'
          ? 'BEVERAGE'
          : 'FOOD';
      await prisma.menuItem.create({
        data: {
          branchId: branch.id,
          categoryId,
          name: fullName,
          description: item.description || null,
          type: type as any,
          price: item.price * 100, // CSV price is in taka, convert to paisa
          costPrice: Math.round(item.price * 40), // estimate 40% cost
          isAvailable: item.status === 'Active',
        },
      });
      menuCount++;
    }
  }
  console.warn(`✅ ${menuCount} menu items imported`);

  // ── Accounts ────────────────────────────────────────────────────────────────
  const accounts = [
    {
      id: 'acc-cash',
      type: 'CASH' as const,
      name: 'Main Cash Register',
      balance: 5000000,
      showInPOS: true,
      linkedPaymentMethod: 'CASH',
    },
    {
      id: 'acc-bkash',
      type: 'MFS' as const,
      name: 'bKash Business',
      balance: 1500000,
      showInPOS: true,
      linkedPaymentMethod: 'MFS',
    },
    {
      id: 'acc-bank',
      type: 'BANK' as const,
      name: 'Dutch-Bangla Bank',
      balance: 25000000,
      showInPOS: false,
      linkedPaymentMethod: null,
    },
    {
      id: 'acc-pos',
      type: 'POS_TERMINAL' as const,
      name: 'Visa/Master POS',
      balance: 800000,
      showInPOS: true,
      linkedPaymentMethod: 'CARD',
    },
  ];

  for (const a of accounts) {
    await prisma.account.upsert({
      where: { id: a.id },
      update: { showInPOS: a.showInPOS, linkedPaymentMethod: a.linkedPaymentMethod },
      create: { ...a, branchId: branch.id },
    });
  }
  console.warn(`✅ ${accounts.length} accounts`);

  // ── Payment Methods (Categories + Options) ─────────────────────────────────
  const paymentCategories = [
    {
      code: 'CASH', name: 'Cash', sortOrder: 1,
      options: [{ code: 'CASH', name: 'Cash Register', accountId: 'acc-cash', isDefault: true }],
    },
    {
      code: 'CARD', name: 'Card', sortOrder: 2,
      options: [{ code: 'CARD_POS', name: 'POS Terminal', accountId: 'acc-pos', isDefault: true }],
    },
    {
      code: 'MFS', name: 'Mobile Banking', sortOrder: 3,
      options: [
        { code: 'BKASH', name: 'bKash', accountId: 'acc-bkash', isDefault: true },
        { code: 'NAGAD', name: 'Nagad', accountId: null, isDefault: false },
      ],
    },
    {
      code: 'DIGITAL', name: 'Digital', sortOrder: 4,
      options: [{ code: 'BANK_TRANSFER', name: 'Bank Transfer', accountId: null, isDefault: true }],
    },
  ];
  let optionCount = 0;
  for (const cat of paymentCategories) {
    const created = await prisma.paymentMethodConfig.upsert({
      where: { branchId_code: { branchId: branch.id, code: cat.code } },
      update: { name: cat.name, sortOrder: cat.sortOrder },
      create: { branchId: branch.id, code: cat.code, name: cat.name, sortOrder: cat.sortOrder },
    });
    for (const opt of cat.options) {
      await prisma.paymentOption.upsert({
        where: { branchId_code: { branchId: branch.id, code: opt.code } },
        update: { name: opt.name, accountId: opt.accountId, isDefault: opt.isDefault },
        create: {
          branchId: branch.id,
          categoryId: created.id,
          code: opt.code,
          name: opt.name,
          accountId: opt.accountId,
          isDefault: opt.isDefault,
          sortOrder: optionCount,
        },
      });
      optionCount++;
    }
  }
  console.warn(`✅ ${paymentCategories.length} payment categories, ${optionCount} options`);

  // ── Sample Expenses ─────────────────────────────────────────────────────────
  const expenseData = [
    {
      category: 'RENT' as const,
      description: 'Monthly shop rent - April',
      amount: 7500000,
      date: '2026-04-01',
    },
    {
      category: 'UTILITIES' as const,
      description: 'Electricity bill - March',
      amount: 1500000,
      date: '2026-03-28',
    },
    {
      category: 'UTILITIES' as const,
      description: 'Water bill - March',
      amount: 300000,
      date: '2026-03-28',
    },
    {
      category: 'SUPPLIES' as const,
      description: 'Kitchen equipment repair',
      amount: 450000,
      date: '2026-03-30',
    },
    {
      category: 'TRANSPORT' as const,
      description: 'Delivery bike fuel',
      amount: 200000,
      date: '2026-04-01',
    },
    {
      category: 'MARKETING' as const,
      description: 'Facebook ads - April',
      amount: 500000,
      date: '2026-04-02',
    },
  ];

  for (const e of expenseData) {
    await prisma.expense.create({
      data: {
        branchId: branch.id,
        category: e.category,
        description: e.description,
        amount: e.amount,
        date: new Date(e.date),
        recordedById: 'staff-owner',
        approvedById: 'staff-owner',
        approvedAt: new Date(),
      },
    });
  }
  console.warn(`✅ ${expenseData.length} sample expenses`);

  // ── Sample Recipes ──────────────────────────────────────────────────────────
  // Link some popular menu items to ingredient recipes
  const butterChicken = await prisma.menuItem.findFirst({
    where: { branchId: branch.id, name: 'Butter Chicken' },
  });
  const chickenFriedRice = await prisma.menuItem.findFirst({
    where: { branchId: branch.id, name: 'Chicken Fried Rice' },
  });
  const cappuccino = await prisma.menuItem.findFirst({
    where: { branchId: branch.id, name: 'Cappuccino (Regular)' },
  });

  // Helper to find ingredient by code
  async function findIng(code: string) {
    return prisma.ingredient.findFirst({
      where: { branchId: branch.id, itemCode: code },
    });
  }

  if (butterChicken) {
    const chickenBreast = await findIng('MET0001');
    const butter = await findIng('DAR0003');
    const tomatoPaste = await findIng('PST0007');
    const cream = await findIng('DAR0002');
    const gingerGarlic = await findIng('PST0003');
    const garamMasala = await findIng('MIX0003');

    const recipe = await prisma.recipe.upsert({
      where: { menuItemId: butterChicken.id },
      update: {},
      create: {
        menuItemId: butterChicken.id,
        notes: 'Classic North Indian butter chicken',
      },
    });

    const recipeIngredients = [
      { ing: chickenBreast, qty: 0.25 }, // 250g chicken
      { ing: butter, qty: 1 }, // 1 pcs butter
      { ing: tomatoPaste, qty: 0.05 }, // 50g paste
      { ing: cream, qty: 1 }, // 1 pcs cream
      { ing: gingerGarlic, qty: 0.01 }, // 10g paste
      { ing: garamMasala, qty: 0.005 }, // 5g mix
    ];

    for (const ri of recipeIngredients) {
      if (ri.ing) {
        await prisma.recipeItem
          .create({
            data: {
              recipeId: recipe.id,
              ingredientId: ri.ing.id,
              quantity: ri.qty,
            },
          })
          .catch(() => {
            /* duplicate ok */
          });
      }
    }
    console.warn('✅ Recipe: Butter Chicken');
  }

  if (chickenFriedRice) {
    const chickenBreast = await findIng('MET0001');
    const jasmineRice = await findIng('GRN0002');
    const soySauce = await findIng('SAU0001');
    const springOnion = await findIng('VEG0021');
    const soyOil = await findIng('OIL0001');

    const recipe = await prisma.recipe.upsert({
      where: { menuItemId: chickenFriedRice.id },
      update: {},
      create: {
        menuItemId: chickenFriedRice.id,
        notes: 'Wok-fried rice with diced chicken',
      },
    });

    const recipeIngredients = [
      { ing: chickenBreast, qty: 0.15 },
      { ing: jasmineRice, qty: 0.2 },
      { ing: soySauce, qty: 1 },
      { ing: springOnion, qty: 0.03 },
      { ing: soyOil, qty: 0.02 },
    ];

    for (const ri of recipeIngredients) {
      if (ri.ing) {
        await prisma.recipeItem
          .create({
            data: {
              recipeId: recipe.id,
              ingredientId: ri.ing.id,
              quantity: ri.qty,
            },
          })
          .catch(() => {});
      }
    }
    console.warn('✅ Recipe: Chicken Fried Rice');
  }

  if (cappuccino) {
    const coffeeBean = await findIng('CHC0001');
    const milk = await findIng('DAR0001');

    const recipe = await prisma.recipe.upsert({
      where: { menuItemId: cappuccino.id },
      update: {},
      create: {
        menuItemId: cappuccino.id,
        notes: 'Espresso with steamed milk foam',
      },
    });

    const recipeIngredients = [
      { ing: coffeeBean, qty: 1 }, // 1 pcs (dose)
      { ing: milk, qty: 1 }, // 1 pcs milk
    ];

    for (const ri of recipeIngredients) {
      if (ri.ing) {
        await prisma.recipeItem
          .create({
            data: {
              recipeId: recipe.id,
              ingredientId: ri.ing.id,
              quantity: ri.qty,
            },
          })
          .catch(() => {});
      }
    }
    console.warn('✅ Recipe: Cappuccino');
  }

  // ── Sample Orders ───────────────────────────────────────────────────────────
  // Create a few sample completed orders
  const sampleMenuItems = await prisma.menuItem.findMany({
    where: { branchId: branch.id, isAvailable: true },
    take: 10,
  });

  if (sampleMenuItems.length >= 4) {
    const orderData = [
      {
        orderNumber: 'ORD-20260403-001',
        cashierId: 'staff-cashier',
        tableNumber: 'T01',
        type: 'DINE_IN' as const,
        items: [
          { menuItem: sampleMenuItems[0], qty: 2 },
          { menuItem: sampleMenuItems[1], qty: 1 },
        ],
        paymentMethod: 'CASH' as const,
        date: '2026-04-03T12:30:00Z',
      },
      {
        orderNumber: 'ORD-20260403-002',
        cashierId: 'staff-cashier',
        tableNumber: 'T03',
        type: 'DINE_IN' as const,
        items: [
          { menuItem: sampleMenuItems[2], qty: 1 },
          { menuItem: sampleMenuItems[3], qty: 2 },
          { menuItem: sampleMenuItems[4] ?? sampleMenuItems[0], qty: 1 },
        ],
        paymentMethod: 'CARD' as const,
        date: '2026-04-03T13:15:00Z',
      },
      {
        orderNumber: 'ORD-20260403-003',
        cashierId: 'staff-cashier',
        tableNumber: null,
        type: 'TAKEAWAY' as const,
        items: [
          { menuItem: sampleMenuItems[5] ?? sampleMenuItems[1], qty: 1 },
          { menuItem: sampleMenuItems[6] ?? sampleMenuItems[2], qty: 2 },
        ],
        paymentMethod: 'MFS' as const,
        date: '2026-04-03T18:00:00Z',
      },
    ];

    // Find table IDs
    const tableMap: Record<string, string> = {};
    const allTables = await prisma.diningTable.findMany({
      where: { branchId: branch.id },
    });
    for (const t of allTables) {
      tableMap[t.tableNumber] = t.id;
    }

    for (const od of orderData) {
      const existing = await prisma.order.findUnique({
        where: { orderNumber: od.orderNumber },
      });
      if (existing) continue;

      let subtotal = 0;
      for (const item of od.items) {
        subtotal += Number(item.menuItem.price) * item.qty;
      }
      const taxAmount = Math.round(subtotal * 0.05);
      const totalAmount = subtotal + taxAmount;
      const createdAt = new Date(od.date);

      const order = await prisma.order.create({
        data: {
          orderNumber: od.orderNumber,
          branchId: branch.id,
          cashierId: od.cashierId,
          tableId: od.tableNumber ? (tableMap[od.tableNumber] ?? null) : null,
          tableNumber: od.tableNumber,
          type: od.type,
          status: 'PAID',
          subtotal,
          taxAmount,
          discountAmount: 0,
          totalAmount,
          paymentMethod: od.paymentMethod,
          paidAt: createdAt,
          createdAt,
        },
      });

      // Order items
      for (const item of od.items) {
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: item.menuItem.id,
            menuItemName: item.menuItem.name,
            quantity: item.qty,
            unitPrice: Number(item.menuItem.price),
            totalPrice: Number(item.menuItem.price) * item.qty,
            kitchenStatus: 'DONE',
          },
        });
      }

      // Payment record
      await prisma.orderPayment.create({
        data: {
          orderId: order.id,
          method: od.paymentMethod,
          amount: totalAmount,
          reference:
            od.paymentMethod === 'MFS'
              ? 'bKash-TXN-98765'
              : od.paymentMethod === 'CARD'
                ? 'POS-REF-12345'
                : null,
        },
      });
    }
    console.warn(`✅ ${orderData.length} sample orders with payments`);
  }

  console.warn('\n🎉 Seed complete!\n');
  console.warn('Login credentials (all passwords: password123):');
  console.warn('  owner@restora.app     — OWNER');
  console.warn('  manager@restora.app   — MANAGER');
  console.warn('  cashier@restora.app   — CASHIER');
  console.warn('  kitchen@restora.app   — KITCHEN');
  console.warn('  barista@restora.app   — KITCHEN (Barista)');
  console.warn('  waiter@restora.app    — WAITER');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
