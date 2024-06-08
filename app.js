const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const Dymo = require("dymojs");
const { JSDOM } = require("jsdom");
const { shopifyApi, ApiVersion } = require("@shopify/shopify-api");
const { default: shopifyNode } = require("@shopify/shopify-api/adapters/node"); // Import the Node adapter
const path = require("path");

// Create a DOMParser instance using jsdom
const { window } = new JSDOM();
const DOMParser = window.DOMParser;
require("dotenv").config();
const apiKey = process.env.API_KEY;
const secret = process.env.SECRET;
const shopUrl = process.env.SHOP_URL;
const accessToken = process.env.ACCESS_TOKEN;
const shopify = shopifyApi({
  apiKey: apiKey,
  apiSecretKey: secret,
  scopes: [
    "read_orders",
    "write_assigned_fulfillment_orders",
    "read_assigned_fulfillment_orders",
    "read_customers",
    "write_draft_orders",
    "read_draft_orders",
    "write_fulfillments",
    "read_fulfillments",
    "write_inventory",
    "read_inventory",
    "write_merchant_managed_fulfillment_orders",
    "read_merchant_managed_fulfillment_orders",
    "write_orders",
    "read_orders",
    "write_products",
    "read_products",
    "write_shipping",
    "read_shipping",
    "write_third_party_fulfillment_orders",
    "read_third_party_fulfillment_orders",
  ],
  hostName: shopUrl,
  accessToken: accessToken,
  apiVersion: ApiVersion.April24,
});
const session = {
  shop: shopUrl,
  accessToken: accessToken,
};

app = express();
app.use(bodyParser.json());

// Read the label XML from the file
const labelXml = getFixedXml(fs.readFileSync("testLabel.dymo", "utf8"));

const dymo = new Dymo();

async function test() {
  //   console.log(labelXml);
  console.log(await dymo.getPrinters());
}

// Handle the Shopify webhook
app.post("/shopify_webhook", async (req, res) => {
  const orderData = req.body;
  //   console.log(orderData);
  if (orderData) {
    const shippingAddress = orderData.shipping_address;
    const orderItems = orderData.line_items;
    const orderNumber = orderData.order_number;

    // Generate the order picking string
    const orderPickingString = orderItems
      .map((item) => {
        const productName = item.name;
        const variantName = item.variant_title;
        const quantity = item.quantity;

        const productInitial = productName.charAt(0).toUpperCase();
        const variantInitial = variantName
          ? variantName.charAt(0).toUpperCase()
          : "";

        return `${productInitial}${variantInitial}${quantity}`;
      })
      .join("");

    // Replace the placeholders in the label XML with actual data
    let modifiedLabelXml = labelXml;
    modifiedLabelXml = modifiedLabelXml.replaceAll(
      "$name",
      shippingAddress.name
    );
    modifiedLabelXml = modifiedLabelXml.replaceAll(
      "$address",
      shippingAddress.address1
    );
    modifiedLabelXml = modifiedLabelXml.replaceAll("$zip", shippingAddress.zip);
    modifiedLabelXml = modifiedLabelXml.replaceAll(
      "$city",
      shippingAddress.city
    );
    modifiedLabelXml = modifiedLabelXml.replaceAll(
      "$country",
      shippingAddress.country
    );
    modifiedLabelXml = modifiedLabelXml.replaceAll("$orderid", orderData.id);
    modifiedLabelXml = modifiedLabelXml.replaceAll("$order", orderNumber);
    modifiedLabelXml = modifiedLabelXml.replaceAll("$PDR", orderPickingString);

    // Create a new instance of the Dymo class
    const dymo = new Dymo();

    // Print the modified label XML
    try {
      await dymo.print("DYMO LabelWriter 450", modifiedLabelXml);
      res.json({
        message: "Webhook received and label printed successfully",
      });
      console.log("Label printed successfully with order #", orderNumber);
    } catch (error) {
      console.error(
        "Error printing label for order with number",
        orderNumber,
        error
      );
      res.status(500).json({ message: "Error printing label" });
    }
  } else {
    res.status(400).json({ message: "Invalid webhook payload" });
  }
});

const publicFolderPath = path.join(__dirname, "public");
app.use(express.static(publicFolderPath));

app.get("/mark_shipped", async (req, res) => {
  const orderNumbers = req.query.orderNumbers.split(",");
  try {
    for (const orderNumber of orderNumbers) {
      await markOrderAsCompleted(orderNumber);
    }
    res.json({ message: "Orders marked as completed successfully" });
  } catch (error) {
    console.error("Error marking orders as completed:", error);
    res.status(500).json({ message: "Error marking orders as completed" });
  }
});

// Start the server
const port = 8080;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  test();
});

function fixChildren(elem) {
  if (elem.children.length == 0) {
    if (elem.outerHTML.endsWith("/>") && !elem.outerHTML.includes("DYMO")) {
      const rawTag = elem.outerHTML
        .substring(0, elem.outerHTML.length - 2)
        .split(" ")[0];
      const cleanTag = rawTag.substring(1, rawTag.length);
      const fixedLine = `${elem.outerHTML.replace("/>", ">")}</${cleanTag}>`;
      return fixedLine;
    }

    return elem.outerHTML;
  }

  const children = Array.from(elem.children);
  const inner = children.map((c) => fixChildren(c)).join("");

  return elem.outerHTML.replace(elem.innerHTML, inner);
}

function getFixedXml(label) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(label, "application/xml");
  const DCDXml = Array.from(doc.getElementsByTagName("DesktopLabel")) ?? [];
  const DLSXml = Array.from(doc.getElementsByTagName("DieCutLabel")) ?? [];
  const elem = DCDXml[0];

  if (!elem) {
    const error = Error(`Label could not be parsed`);
    throw error;
  }

  const fixed = fixChildren(elem);
  return fixed;
}

async function markOrderAsCompleted(orderId) {
  const client = new shopify.clients.Rest({ session: session });

  const fulfillment_order = await client.get({
    path: "orders/" + orderId + "/fulfillment_orders.json",
  });

  // Prepare the fulfillment data
  const fulfillmentData = {
    fulfillment: {
      line_items_by_fulfillment_order: [
        {
          fulfillment_order_id: fulfillment_order.body.fulfillment_orders[0].id,
        },
      ],
      notify_customer: true,
      api_version: ApiVersion.April24,
    },
  };
  // Create the fulfillment to mark the order as completed
  const fulfillmentResponse = await client.post({
    path: `fulfillments.json`,
    data: fulfillmentData,
    type: "application/json",
  });

  console.log(
    "Order marked as completed:",
    fulfillmentResponse.body.fulfillment.name
  );
}
