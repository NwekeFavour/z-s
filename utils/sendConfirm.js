const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendOrderConfirmationEmail = async ({ user, orderId, items, total_price, shipping_address }) => {
  const frontendURL = process.env.FRONTEND_URL || "https://zandmarket.co.uk";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <div style="max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #02498b; color: #fff; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">ZandMarket</h1>
        </div>
        <div style="padding: 20px;">
          <p>Hi <strong>${user.name}</strong>,</p>
          <p>Thank you for your order <strong>#${orderId}</strong>!</p>
          <p><strong>Shipping Address:</strong> ${shipping_address || 'N/A'}</p>
          <h3 style="margin-top: 20px;">Order Items:</h3>
          <ul>
            ${items.map(i => `<li>${i.name} x ${i.quantity} - £${i.price.toFixed(2)}</li>`).join("")}
          </ul>
          <p style="margin-top: 20px; text-align: center;">
            <a href="${frontendURL}/shop" style="background: #02498b; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Shop More Products</a>
          </p>
        </div>
      </div>
    </div>
  `;

  await sgMail.send({
    to: user.email,
    from: "foodstuffs@zandmarket.so.uk", // verified sender
    subject: `Order Confirmation #${orderId}`,
    html: htmlContent
  });
};

module.exports = sendOrderConfirmationEmail; // ✅ default export
