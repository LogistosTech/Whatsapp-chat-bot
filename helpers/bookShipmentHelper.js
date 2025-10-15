import axios from "axios";
import sendListMessage from "../functions/sendListMessage.js";
import sendMessage from "../functions/sendMessage.js";
import BookShipment from "../models/bookShipmentModel.js";
import Session from "../models/sessionModel.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import getShipmentAPI from "../APIS/getShipmentAPI.js";
import createOrderAPI from "../APIS/createOrderAPI.js";
import createShipmentAPI from "../APIS/createShipmentAPI.js";
import walletBalanceAPI from "../APIS/walletBalanceAPI.js";

const specialDeliveryOptions = [
  {
    type: "text",
    title: "None",
    description: "No special delivery required",
    postbackText: "-1",
  },
  {
    type: "text",
    title: "SEZ/Govt",
    description: "Special Economic Zone, Govt, or Canteen delivery",
    postbackText: "0",
  },
  {
    type: "text",
    title: "Sunday/Holiday",
    description: "Delivery on Sunday or holiday",
    postbackText: "1",
  },
  {
    type: "text",
    title: "Mail delivery",
    description: "Delivery via mail",
    postbackText: "2",
  },
  {
    type: "text",
    title: "Plant Delivery",
    description: "Delivery to a plant location",
    postbackText: "3",
  },
];

const bookShipmentHelper = async (phone, session, user_resp = "", msgType) => {
  try {
    if (session.operation === null||session.operation === "tracking") {
      session.operation = "booking";
      session.trackingStatus = "init";
      await session.save();
    }

    let book_session = await BookShipment.findOne({ phone });

    if (user_resp.toLowerCase() === "logout") {
      await Session.deleteOne({ phone });
      await BookShipment.deleteOne({ phone });
      await sendMessage(
        phone,
        '✅ You have been logged out. Type "hi" to log in again.'
      );
      return;
    }

    if (user_resp.toLowerCase() === "restart") {
      await BookShipment.deleteOne({ phone });
      await sendMessage(
        phone,
        '✅ Your booking session has been restarted. Type "hi" to start again.'
      );
      return;
    }

    let pickupList, dropList;

    // Check if session exists and pickup/drop warehouses are already set
    if (
      book_session &&
      Array.isArray(book_session.pickupWarehouses) &&
      book_session.pickupWarehouses.length > 0 &&
      Array.isArray(book_session.dropWarehouses) &&
      book_session.dropWarehouses.length > 0
    ) {
      pickupList = book_session.pickupWarehouses;
      dropList = book_session.dropWarehouses;
    } else {
      const [pickupRes, dropRes] = await Promise.all([
        axios.get(
          "https://admin.logistos.in/seller/warehouses/?warehouse_type=1",
          {
            headers: {
              Authorization: `Bearer ${session.token}`,
              Accept: "application/json, text/plain, */*",
              Referer: "https://portal.logistos.in/",
              "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
            },
          }
        ),
        axios.get(
          "https://admin.logistos.in/seller/warehouses/?warehouse_type=2",
          {
            headers: {
              Authorization: `Bearer ${session.token}`,
              Accept: "application/json, text/plain, */*",
              Referer: "https://portal.logistos.in/",
              "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
            },
          }
        ),
      ]);
      pickupList = pickupRes.data;
      dropList = dropRes.data;

      await BookShipment.findOneAndUpdate(
        { phone },
        {
          pickupWarehouses: pickupList,
          dropWarehouses: dropList,
          selectedPickupId: null,
          selectedDropId: null,
          state: "init",
        },
        { upsert: true, new: true }
      );
    }


    book_session = await BookShipment.findOne({ phone });
    let book_state = book_session.state || "";

    // Main flow based on current state
    switch (book_state) {
      case "init":
        book_session.state = "awaiting_courier_type";
        await book_session.save();
        await sendQuickReplies(
          phone,
          [
            { title: "B2B", postbackText: "B2B" },
            { title: "B2C", postbackText: "B2C" },
          ],
          "Please choose the type of courier service you want to book:",
          "Courier Type",
          "Choose an option below"
        );
        break;

      case "awaiting_courier_type":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid courier type from the options provided."
          );
          return;
        }
        book_session.courier_type = user_resp; // B2B or B2C

        const warehousePickupOptions = pickupList.slice(0, 7).map((w) => ({
          type: "text",
          title: (w.name || w.address?.address_line_1 || "Unnamed").slice(0, 8),
          description: `${w.name || w.address?.address_line_1 || "Unnamed"} ${w.address?.city || ""} ${w.address?.pincode || ""}`.trim().slice(0, 50),
          postbackText: w.id ? String(w.id) : "no_id",
        }));

        book_session.state = "awaiting_pickup";
        await book_session.save();

        await sendListMessage(
          phone,
          "Pickup Warehouse",
          "Please choose a Pickup warehouse from the list below:",
          warehousePickupOptions
        );
        break;

      case "awaiting_pickup":
        if (msgType !== "list_reply") {
          await sendMessage(
            phone,
            "Please select a valid Pickup warehouse from the list."
          );
          return;
        }

        book_session.selectedPickupId = user_resp;
        book_session.state = "awaiting_drop";
        await book_session.save();

        const warehouseDropOptions = dropList.slice(0, 7).map((w) => ({
          type: "text",
          title: (w.name || w.address?.address_line_1 || "Unnamed").slice(0, 8),
          description: `${w.name || w.address?.address_line_1 || "Unnamed"} ${w.address?.city || ""} ${w.address?.pincode || ""}`.trim().slice(0, 50),
          postbackText: w.id ? String(w.id) : "no_id",
        }));

        await sendListMessage(
          phone,
          "Drop Warehouse",
          "Please choose a Drop warehouse from the list below:",
          warehouseDropOptions
        );

        break;

      case "awaiting_drop":
        if (msgType !== "list_reply") {
          await sendMessage(
            phone,
            "Please select a valid Drop warehouse from the list."
          );
          return;
        }

        book_session.selectedDropId = user_resp;
        book_session.state = "awaiting_unit_info";
        await book_session.save();

        await sendQuickReplies(
          phone,
          [
            { title: "CM", postbackText: "CM" },
            { title: "INCH", postbackText: "IN" },
          ],
          "Whats your Unit of measurement?",
          "Measurement Unit",
          "Choose an option below"
        );

        break;

      case "awaiting_unit_info":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid Unit of measurement from the options provided."
          );
          return;
        }

        book_session.unitOfMeasurement = user_resp; //=== "CM" ? "CM" : "IN";
        if (book_session.courier_type === "B2B") {
          book_session.state = "awaiting_basic_info";
          await sendMessage(
            phone,
            "Please provide the *Number of Box types* you want to ship."
          );
        } else {
          book_session.state = "awaiting_box_details_b2c";
          await sendMessage(
            phone,
            `Got it! Please provide the details for the box type in the following format:\n\nWeight per Box (kg), Length (cm), Width (cm), Height (cm)\n\nExample: 2.5, 30, 20, 15\n*Box Count is fixed to 1 for B2C*`
          );
        }
        await book_session.save();
        break;

      case "awaiting_basic_info":
        const cleanResp = String(user_resp).trim();
        if (!/^\d+$/.test(cleanResp)) {
          await sendMessage(
            phone,
            "❌ Please enter a valid number for the *Number of Box types*."
          );
          return;
        }
        book_session.totalBoxTypes = parseInt(cleanResp, 10);
        book_session.boxDetails = [];
        book_session.state = "awaiting_box_details";
        await book_session.save();
        await sendMessage(
          phone,
          `Got it! You have ${book_session.totalBoxTypes} box types. Please provide the details for each box type in the following format:\n\nCount, Weight per Box (kg), Length (cm), Width (cm), Height (cm)\n\nExample: 10, 2.5, 30, 20, 15`
        );
        break;

      case "awaiting_box_details_b2c":
        const parts = user_resp.split(",").map((val) => parseFloat(val.trim()));

        if (parts.length !== 4 || parts.some(isNaN)) {
          await sendMessage(
            phone,
            "❌ Invalid format. Please enter *four* values like this:\nWeight, Length, Width, Height\nExample: 2.5, 30, 20, 15"
          );
          return;
        }

        console.log("Received box details:", parts);

        const [weightPerBox, length, width, height] = parts;
        const count = 1;

        book_session.boxDetails = [
          {
            count,
            weightPerBox,
            length,
            width,
            height,
          },
        ];

        await BookShipment.findOneAndUpdate(
          { phone },
          { boxDetails: book_session.boxDetails }
        );

        book_session = await BookShipment.findOne({ phone });

        book_session.state = "awaiting_invoice_date";
        await book_session.save();

        await sendMessage(
          phone,
          "All box details recorded! Now, please provide the *Invoice Date* (YYYY-MM-DD)."
        );

        break;

      case "awaiting_box_details":
        if (book_session.boxDetails.length < book_session.totalBoxTypes) {
          const parts = user_resp
            .split(",")
            .map((val) => parseFloat(val.trim()));
          if (parts.length !== 5 || parts.some(isNaN)) {
            await sendMessage(
              phone,
              "❌ Invalid format. Please enter *five* values like this:\nCount, Weight, Length, Width, Height\nExample: 10, 2.5, 30, 20, 15"
            );
            return;
          }

          console.log("Received box details:", parts);

          const [count, weightPerBox, length, width, height] = parts;

          book_session.boxDetails.push({
            count,
            weightPerBox,
            length,
            width,
            height,
          });

          console.log("Updated box details-1:", book_session.boxDetails);

          await BookShipment.findOneAndUpdate(
            { phone },
            { boxDetails: book_session.boxDetails }
          );
        }

        book_session = await BookShipment.findOne({ phone });
        //console.log('Current box details:', book_session.boxDetails);

        console.log("Updated box details-2:", book_session.boxDetails);

        if (book_session.boxDetails.length < book_session.totalBoxTypes) {
          await sendMessage(
            phone,
            `Got it! Please provide the details for the next box type in the same format. (${
              book_session.boxDetails.length + 1
            }/${book_session.totalBoxTypes})`
          );
        } else {
          book_session.state = "awaiting_invoice_date";
          await book_session.save();
          book_session = await BookShipment.find({ phone });

          console.log("Updated box details-3:", book_session.boxDetails);
          await sendMessage(
            phone,
            "All box details recorded! Now, please provide the *Invoice Date* (YYYY-MM-DD)."
          );
        }
        break;

      case "awaiting_invoice_date":
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(user_resp)) {
          await sendMessage(
            phone,
            "❌ Please enter a valid date in the format *YYYY-MM-DD*."
          );
          return;
        }
        book_session.invoiceDate = user_resp;
        book_session.state = "awaiting_invoice_value";
        await book_session.save();
        await sendMessage(
          phone,
          "Got it! Now, please provide the *Invoice Value* (in ₹)."
        );
        break;

      case "awaiting_invoice_value":
        // store invoice value
        const invoiceValue = parseFloat(user_resp);
        if (isNaN(invoiceValue) || invoiceValue <= 0) {
          await sendMessage(
            phone,
            "❌ Please enter a valid number for the *Invoice Value* (in ₹)."
          );
          return;
        }
        book_session.invoiceValue = invoiceValue;
        book_session.state = "awaiting_invoice_number";
        await book_session.save();
        await sendMessage(
          phone,
          "Got it! Now, please provide the *Invoice Number*."
        );
        break;

      case "awaiting_invoice_number":
        // store invoice number
        book_session.invoiceNumber = user_resp;
        if (book_session.invoiceValue >= 50000) {
          book_session.state = "awaiting_eway_bill_no";
          await sendMessage(
            phone,
            "Got it! Now, please provide the *E-Way Bill Number*."
          );
        } else {
          if (book_session.courier_type === "B2B") {
            book_session.state = "awaiting_special_delivery";

            await sendListMessage(
              phone,
              "Special Delivery Type",
              "Please choose a special delivery type from the list below:",
              specialDeliveryOptions
            );
          } else {
            book_session.state = "awaiting_payment_mode";

            await sendQuickReplies(
              phone,
              [
                { title: "COD", postbackText: "1" },
                { title: "Prepaid", postbackText: "0" },
                { title: "TO-PAY", postbackText: "2" },
              ],
              "How would you like to pay for this shipment?",
              "Payment Mode",
              "Choose an option below"
            );
          }
        }
        await book_session.save();

        break;

      case "awaiting_eway_bill_no":
        // store eway bill number
        book_session.ewayBillNo = user_resp;
        if (book_session.courier_type === "B2C") {
          book_session.state = "awaiting_payment_mode";

          await sendQuickReplies(
            phone,
            [
              { title: "COD", postbackText: "1" },
              { title: "Prepaid", postbackText: "0" },
              { title: "TO-PAY", postbackText: "2" },
            ],
            "How would you like to pay for this shipment?",
            "Payment Mode",
            "Choose an option below"
          );
        } else {
          book_session.state = "awaiting_special_delivery";
          await sendListMessage(
            phone,
            "Special Delivery Type",
            "Please choose a special delivery type from the list below:",
            specialDeliveryOptions
          );
        }
        await book_session.save();

        break;

      case "awaiting_special_delivery":
        // store special delivery type
        if (msgType !== "list_reply") {
          await sendMessage(
            phone,
            "Please select a valid Special Delivery Type from the list."
          );
          return;
        }
        book_session.specialDeliveryType = user_resp === "-1" ? "" : user_resp;
        book_session.state = "awaiting_payment_mode";
        await book_session.save();
        await sendQuickReplies(
          phone,
          [
            { title: "COD", postbackText: "1" },
            { title: "Prepaid", postbackText: "0" },
            { title: "TO-PAY", postbackText: "2" },
          ],
          "How would you like to pay for this shipment?",
          "Payment Mode",
          "Choose an option below"
        );
        break;

      case "awaiting_payment_mode":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid Payment mode from the options provided."
          );
          return;
        }

        if (user_resp === "1") {
          book_session.paymentMode = 1;
          book_session.state = "awaiting_cod_info";

          await sendMessage(
            phone,
            "You selected COD. Please provide the *COD Amount* (in ₹)."
          );
        } else if (user_resp === "2") {
          book_session.paymentMode = 2;
          book_session.state = "awaiting_cod_info";

          await sendMessage(
            phone,
            "You selected COD. Please provide the *COD Amount* (in ₹)."
          );
        } else if (user_resp === "0") {
          book_session.paymentMode = 0;
          book_session.state = "awaiting_rov_insurance";

          await sendQuickReplies(
            phone,
            [
              { title: "Carrier Risk", postbackText: "rov_carrier" },
              { title: "Owner Risk", postbackText: "rov_owner" },
            ],
            "You selected Prepaid. Please provide the *Insurance Type*",
            "Insurance Type",
            "Choose an option below"
          );
        } else {
          await sendMessage(
            phone,
            "Please select an appropriate Payment mode from the given options!!"
          );
          return;
        }
        await book_session.save();

        break;

      case "awaiting_cod_info":
        if (isNaN(user_resp) || parseFloat(user_resp) <= 0) {
          await sendMessage(
            phone,
            "❌ Please enter a valid *COD Amount* (in ₹)."
          );
          return;
        }

        let amnt = parseFloat(user_resp);
        if (amnt > book_session.invoiceValue) {
          await sendMessage(
            phone,
            "❌ COD Amount cannot be greater than Invoice Value. Please enter a valid *COD Amount* (in ₹)."
          );
        } else {
          book_session.codAmount = amnt;
        }

        book_session.state = "awaiting_rov_insurance";
        await book_session.save();
        await sendQuickReplies(
          phone,
          [
            { title: "Carrier Risk", postbackText: "rov_carrier" },
            { title: "Owner Risk", postbackText: "rov_owner" },
          ],
          "You selected Prepaid. Please provide the *Insurance Type*",
          "Insurance Type",
          "Choose an option below"
        );
        break;

      case "awaiting_rov_insurance":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid Insurance Type from the options provided."
          );
          return;
        }

        console.log("📦 User response for Insurance Type:", user_resp);

        book_session.rovInsuranceType = user_resp; // Assuming user_resp is "0" or "1"
        book_session.state = "awaiting_shipment_mode";
        await book_session.save();
        await sendQuickReplies(
          phone,
          [
            { title: "Surface", postbackText: "surface" },
            { title: "Air", postbackText: "air" },
            { title: "Railway", postbackText: "railway" },
          ],
          "Please choose a shipment mode from the list below:",
          "Shipment Mode",
          "Choose an option below"
        );
        break;

      case "awaiting_shipment_mode":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid Shipment Mode from the options provided."
          );
          return;
        }

        book_session.shipmentMode = user_resp;
        book_session.state = "awaiting_order_ready_date";
        await book_session.save();
        await sendMessage(
          phone,
          "Please provide the *Order Ready Date* (YYYY-MM-DD). "
        );
        break;

      case "awaiting_order_ready_date":
        const orderDateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!orderDateRegex.test(user_resp)) {
          await sendMessage(
            phone,
            "❌ Please enter a valid date in the format *YYYY-MM-DD*."
          );
          return;
        }

        // Check if order ready date is not older than today
        const inputDate = new Date(user_resp);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to midnight for accurate comparison

        if (inputDate < today) {
          await sendMessage(
            phone,
            "❌ Order Ready Date cannot be older than today's date. Please enter a valid date (today or future)."
          );
          return;
        }

        book_session.orderReadyDate = user_resp;
        book_session.state = "awaiting_hsn_code";
        await book_session.save();
        await sendQuickReplies(
          phone,
          [{ title: "Not Required", postbackText: "NA" }],
          "Got it! Now, please provide the *HSN Code* for the products.",
          "HSN Code",
          "Select *Not Required* if inapplicable"
        );
        break;

      case "awaiting_hsn_code":
        book_session.hsnCode =
          user_resp.toLowerCase() === "na" ? "" : user_resp;
        book_session.state = "awaiting_product_name";
        await book_session.save();

        await sendQuickReplies(
          phone,
          [{ title: "Not Required", postbackText: "NA" }],
          "Got it! Now, please provide the *Product Name*.",
          "Product Name",
          "Select *Not Required* if inapplicable"
        );
        break;

      case "awaiting_product_name":
        book_session.productName =
          user_resp.toLowerCase() === "na" ? "" : user_resp;
        if (book_session.courier_type === "B2B") {
          book_session.state = "awaiting_self_drop";
          await sendQuickReplies(
            phone,
            [
              { title: "Yes", postbackText: "yes" },
              { title: "No", postbackText: "no" },
            ],
            "Do you want to self-drop the shipment?",
            "Need Self-Drop?",
            "Choose an option below"
          );
        } else {
          book_session.state = "awaiting_courier_options";
          await sendQuickReplies(
            phone,
            [
              { title: "Check Rates", postbackText: "yes" },
              { title: "Cancel", postbackText: "no" },
            ],
            "Proceed with checking the available couriers and their rates?",
            "Check Rates",
            "IF you cancel you will go back to the main menu"
          );
        }
        await book_session.save();

        break;

      case "awaiting_self_drop":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid option for self-drop from the quick replies."
          );
          return;
        }

        book_session.selfDrop = user_resp === "yes";
        book_session.state = "awaiting_courier_options";
        await book_session.save();
        await sendQuickReplies(
          phone,
          [
            { title: "Check Rates", postbackText: "yes" },
            { title: "Cancel", postbackText: "no" },
          ],
          "Proceed with checking the available couriers and their rates?",
          "Check Rates",
          "IF you cancel you will go back to the main menu"
        );
        break;

      case "awaiting_courier_options":
        if (msgType !== "button_reply") {
          await sendMessage(
            phone,
            "Please select a valid option from the quick replies."
          );
        }

        console.log("📦 User response for Checking rates:", user_resp);

        //await session.updateOne({ operation: null });

        if (user_resp === "no") {
          book_session.state = "init";
          await book_session.save();
          await session.updateOne({ operation: null });
          await sendMessage(
            phone,
            "🚫 Booking cancelled. You can start over by typing 'hi'."
          );
          return;
        }

        const resp_checkrates = await getShipmentAPI(phone);

        if (!resp_checkrates) {
          await sendQuickReplies(
            phone,
            [
              { title: "Check Rates", postbackText: "yes" },
              { title: "Cancel", postbackText: "no" },
            ],
            "Failed fetching the available couriers-rates. Fetch again?",
            "Check Rates",
            "IF you cancel you will go back to the main menu"
          );
          return;
        }

        console.log("📦 Got the get-shipment Response processing....");

        const validCourierOptions = Object.values(resp_checkrates).filter(
          (option) => typeof option.rates === "number" && !isNaN(option.rates)
        );

        //console.log('📦 Valid Courier Options:', validCourierOptions);

        book_session.courierOptions = validCourierOptions;
        book_session.state = "awaiting_extra_info_1";
        await book_session.save();

        console.log("📦 Updated Book Session with Courier Options!!");

        await sendQuickReplies(
          phone,
          [{ title: "Not Required", postbackText: "NA" }],
          "Provide your *Recipient GST Number* ",
          "GST Info",
          "Select *Not Required* if inapplicable"
        );
        break;

      case "awaiting_extra_info_1":
        console.log("📦 Inside User GST info state:");

        book_session.receipientGST =
          user_resp.trim().toLowerCase() === "na" ? "" : user_resp.trim();
        book_session.state = "awaiting_extra_info_2";
        await book_session.save();

        console.log("Moving to next state awaiting_extra_info_2");

        await sendQuickReplies(
          phone,
          [{ title: "Not Required", postbackText: "NA" }],
          "Provide any additional *Remarks* for the courier.",
          "Remarks (Optional)",
          "Select *Not Required* if inapplicable"
        );
        break;

      case "awaiting_extra_info_2":
        console.log("📦 Inside User Remarks info state:");
        book_session.remarks =
          user_resp.trim().toLowerCase() === "na"
            ? "Created By whatsapp bot"
            : user_resp.trim();
        book_session.state = "awaiting_confirmation";
        await book_session.save();

        book_session = await BookShipment.findOne({ phone });
        const courierOptions = book_session.courierOptions
          .slice(0, 5)
          .map((option) => ({
            type: "text",
            title: option.delivery_partner,
            description: `Rate: ₹${option.rates} - ${option.delivery_partner}`,
            postbackText: option.id,
          }));

        //console.log('📦 Preparing to send courier options:', courierOptions);

        await sendListMessage(
          phone,
          "Select a Courier",
          "Please select a Courier from the given list:",
          courierOptions
        );

        break;

      case "awaiting_confirmation":
        if (msgType !== "list_reply") {
          await sendMessage(
            phone,
            "Please select a valid option from the options only."
          );
        }

        if (user_resp === "-1") {
          book_session.state = "init";
          await book_session.save();
          await session.updateOne({ operation: null });
          await sendMessage(
            phone,
            "🚫 Booking cancelled. You can start over by typing 'hi'."
          );
          return;
        }

        book_session.selectedCourier = Number(user_resp);
        const selectedOption = book_session.courierOptions.find(
          (option) => Number(option.id) === book_session.selectedCourier
        );
        book_session.modeId = selectedOption ? selectedOption.mode_id : null;
        await book_session.save();
        const resp_order = await createOrderAPI(phone);
        if (!resp_order) {
          await sendQuickReplies(
            phone,
            [{ title: "Cancel", postbackText: "-1" }],
            "❌ Failed to *Create Order*. Please select the courier again or cancel to start over.",
            "Logistos Bot",
            "Choose an option below"
          );

          return;
        }

        const walletBal = await walletBalanceAPI(phone);

        const selectedCourierOption = book_session.courierOptions.find(
          (option) => Number(option.id) === book_session.selectedCourier
        );
        const selectedCourierRate = selectedCourierOption
          ? selectedCourierOption.rates
          : null;

        if (walletBal.wallet_balance - selectedCourierRate < 500) {
          await sendMessage(
            phone,
            `❌ Insufficient wallet balance. Your minimum wallet balance must be ₹ 500 at all times. Please recharge your wallet or select a different courier.`
          );
          return;
        }

        const resp_shipment = await createShipmentAPI(phone, resp_order);
        if (!resp_shipment) {
          await sendQuickReplies(
            phone,
            [{ title: "Cancel", postbackText: "-1" }],
            "❌ Failed to *Create Shipment*. Please select the courier again or cancel to start over.",
            "Logistos Bot",
            "Choose an option below"
          );

          return;
        }

        book_session.state = "init";
        await book_session.save();

        await sendMessage(
          phone,
          "🎉 Your shipment booking is complete! Our team will contact you shortly with the details."
        );

        //let pickLoc = "";
        let pickPin = "";
        let pickCity = "";
        if (Array.isArray(book_session?.pickupWarehouses)) {
          const selectedPickup = book_session.pickupWarehouses.find(
            (w) => String(w.id) === String(book_session?.selectedPickupId)
          );
          //pickLoc = (selectedPickup?.name).slice(0, 6) || "";
          pickPin = selectedPickup?.address?.pincode || "";
          pickCity = selectedPickup?.address?.city || "";
        }

        //let dropLoc = "";
        let dropPin = "";
        let dropCity = "";
        if (Array.isArray(book_session?.dropWarehouses)) {
          const selectedDrop = book_session.dropWarehouses.find(
            (w) => String(w.id) === String(book_session?.selectedDropId)
          );
          // dropLoc = (selectedDrop?.name).slice(0, 6) || "";
          dropPin = selectedDrop?.address?.pincode || "";
          dropCity = selectedDrop?.address?.city || "";
        }

        book_session = await BookShipment.findOne({ phone });

        await sendMessage(
          phone,
          `📦 Shipment Details:\n\n- *Order ID*: ${book_session.orderId}\n- *Shipment ID*: ${book_session.shipmentId}\n- *Courier*: ${selectedCourierOption.delivery_partner}\n- *Rate*: ₹${selectedCourierRate}\n- *Pickup Warehouse*: ${pickPin}-${pickCity}\n- *Drop Warehouse*: ${dropPin}-${dropCity}`
    );

        session = await Session.findOne({ phone });
        session.operation = null;
        await session.save();

        await sendQuickReplies(
          phone,
          [
            { title: "Book a Shipment", postbackText: "book" },
            { title: "Track an Order", postbackText: "track" },
          ],
          "Where to next?",
          "Logistos Bot",
          "Choose an option below"
        );
        break;

      default:
        // fallback
        await sendMessage(
          phone,
          "⚠️ An unexpected error occurred. Please try again later."
        );
        break;
    }
  } catch (error) {
    console.error("Error in bookShipmentHelper:", error);
    await sendMessage(
      phone,
      "❌ An error occurred while processing your request. Please try again later."
    );
  }
};

export default bookShipmentHelper;
