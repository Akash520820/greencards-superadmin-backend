const PDFDocument = require("pdfkit");

const generateOrderInvoicePDF = (order) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      // Header
      doc
        .fillColor("#10b981")
        .fontSize(24)
        .text("GreenCard E-Commerce", 50, 45)
        .fontSize(10)
        .fillColor("#64748b")
        .text("Official Order Tax Invoice", 50, 75)
        .moveDown();

      // Divider line
      doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(50, 95).lineTo(550, 95).stroke();

      // Order Summary Info
      doc
        .fontSize(10)
        .fillColor("#1e293b")
        .text(`Invoice Date: ${new Date(order.createdAt).toLocaleDateString("en-IN")}`, 50, 110)
        .text(`Order ID: ${order._id}`, 50, 125)
        .text(`Payment Method: ${order.paymentMethod?.toUpperCase()}`, 50, 140)
        .text(`Payment Status: ${order.paymentStatus?.toUpperCase()}`, 50, 155);

      // Shipping Address Info
      if (order.shippingAddress) {
        const sa = order.shippingAddress;
        doc
          .text("Shipping Address:", 320, 110, { underline: true })
          .text(sa.fullName || "", 320, 125)
          .text(`${sa.addressLine1}${sa.addressLine2 ? ", " + sa.addressLine2 : ""}`, 320, 140)
          .text(`${sa.city}, ${sa.state} - ${sa.pincode}`, 320, 155)
          .text(`Phone: ${sa.phone}`, 320, 170);
      }

      // Divider
      doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(50, 195).lineTo(550, 195).stroke();

      // Table Header
      let y = 210;
      doc
        .fontSize(10)
        .fillColor("#0f172a")
        .text("Item Name", 50, y, { width: 220 })
        .text("Qty", 280, y, { width: 40, align: "center" })
        .text("Price", 330, y, { width: 80, align: "right" })
        .text("Total", 430, y, { width: 90, align: "right" });

      doc.strokeColor("#cbd5e1").lineWidth(1).moveTo(50, y + 15).lineTo(550, y + 15).stroke();

      // Items Rows
      y += 25;
      doc.fontSize(9).fillColor("#334155");

      order.items.forEach((item) => {
        const itemTotal = item.price * item.quantity;
        const variantStr = item.variant?.color || item.variant?.size 
          ? ` (${[item.variant?.color, item.variant?.size].filter(Boolean).join(" / ")})` 
          : "";

        doc
          .text(`${item.name}${variantStr}`, 50, y, { width: 220 })
          .text(`${item.quantity}`, 280, y, { width: 40, align: "center" })
          .text(`₹${item.price}`, 330, y, { width: 80, align: "right" })
          .text(`₹${itemTotal}`, 430, y, { width: 90, align: "right" });

        y += 20;
      });

      doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(50, y + 5).lineTo(550, y + 5).stroke();

      // Summary Totals
      y += 15;
      doc
        .fontSize(10)
        .fillColor("#475569")
        .text("Items Price:", 320, y, { width: 100, align: "right" })
        .text(`₹${order.itemsPrice}`, 430, y, { width: 90, align: "right" });

      y += 15;
      doc
        .text("Shipping Fee:", 320, y, { width: 100, align: "right" })
        .text(`₹${order.shippingPrice}`, 430, y, { width: 90, align: "right" });

      if (order.discountAmount && order.discountAmount > 0) {
        y += 15;
        doc
          .fillColor("#16a34a")
          .text("Coupon Discount:", 320, y, { width: 100, align: "right" })
          .text(`-₹${order.discountAmount}`, 430, y, { width: 90, align: "right" });
      }

      y += 20;
      doc
        .fontSize(12)
        .fillColor("#0f172a")
        .text("Total Paid:", 320, y, { width: 100, align: "right" })
        .text(`₹${order.totalPrice}`, 430, y, { width: 90, align: "right" });

      // Footer
      doc
        .fontSize(8)
        .fillColor("#94a3b8")
        .text("Thank you for shopping with GreenCard! For support, contact support@greencard.com", 50, 720, {
          align: "center",
          width: 500,
        });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generateOrderInvoicePDF };
