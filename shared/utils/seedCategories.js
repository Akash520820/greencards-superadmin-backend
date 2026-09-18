const Category = require("../../models/category.model");

const DEFAULT_CATEGORIES = [
  {
    name: "Vegetables",
    description: "Organic & fresh farm vegetables",
    image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=300",
  },
  {
    name: "Fruits",
    description: "Fresh seasonal fruits",
    image: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=300",
  },
  {
    name: "Drinks",
    description: "Soft drinks, juices & beverages",
    image: "https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=300",
  },
  {
    name: "Instant",
    description: "Instant noodles, soups & snacks",
    image: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=300",
  },
  {
    name: "Dairy",
    description: "Milk, butter, paneer & cheese",
    image: "https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=300",
  },
  {
    name: "Bakery",
    description: "Freshly baked breads & cakes",
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=300",
  },
  {
    name: "Grains",
    description: "Rice, wheat flour & pulse staples",
    image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300",
  },
];

const seedCategories = async () => {
  try {
    for (const catData of DEFAULT_CATEGORIES) {
      const existing = await Category.findOne({
        $or: [{ name: catData.name }, { slug: catData.name.toLowerCase() }],
      });
      if (!existing) {
        await Category.create(catData);
        console.log(`[CategorySeeder] Seeded default category: ${catData.name}`);
      }
    }
  } catch (error) {
    console.error("[CategorySeeder] Error seeding default categories:", error.message);
  }
};

module.exports = seedCategories;
