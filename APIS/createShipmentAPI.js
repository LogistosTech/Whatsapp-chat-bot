import axios from "axios";
import moment from "moment";
import Session from "../models/sessionModel.js";
import BookShipment from "../models/bookShipmentModel.js";

const createShipmentAPI = async (phone, resp_order) => {
  try {
    console.log(`📦 Creating shipment for phone: ${phone}`);
    let session = await Session.findOne({ phone });
    let booking = await BookShipment.findOne({ phone });

    const reqData = {};
    reqData.client_id = Number(session?.clientId) || null;
    reqData.order_id = Number(resp_order?.id) || null;
    reqData.remarks = booking?.remarks;
    reqData.receiver_gst = booking?.receipientGST || "";
    reqData.to_pay_amount =
      booking?.paymentMode === 2 ? String(booking?.codAmount) : "0";
    reqData.is_cod = booking?.paymentMode === 1 ? true : false;
    reqData.mode_id = Number(booking?.modeId) || null;
    reqData.delivery_partner_id = Number(booking?.selectedCourier) || null;
    reqData.pickup_date_time = resp_order?.pickup_date_time || null;
    reqData.eway_bill_no = booking?.ewayBillNo || "";
    reqData.invoice_value = String(booking?.invoiceValue) || "0";
    reqData.invoice_number = String(booking?.invoiceNumber) || "";
    reqData.invoice_date = String(booking?.invoiceDate) || null;
    reqData.source = "system";
    reqData.attached_docs = [];
    reqData.shipment_payment_type = String(booking?.paymentMode) || "0";
    reqData.self_drop = booking?.selfDrop || false;
    reqData.rov_mode = booking?.rovInsuranceType || "rov_owner";
    reqData.special_delivery_type = String(booking?.specialDeliveryType || "");
    reqData.hsn_code = booking?.hsnCode || "";
    // reqData.product_name = booking?.productName || "";
    // reqData.package_content = booking?.productName || "";

    let token = session?.token || "";

    console.log("📦 Create Shipment request data:", reqData);
    

    const response = await axios.post(
      "https://admin.logistos.in/seller/create_shipment/",
      reqData,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          Authorization: `Bearer ${token}`,
          Origin: "https://portal.logistos.in",
          Referer: "https://portal.logistos.in/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        },
      }
    );

    console.log("✅ Shipment created successfully:", response.data);

    // Update the booking with the new shipment ID
    await BookShipment.findOneAndUpdate(
      { phone },
      { shipmentId: response.data.id },
      { new: true }
    );

    return response.data; 
  } catch (error) {
    console.error(`❌ Error creating shipment for phone ${phone}:`, error);
    throw error; 
  }
};

export default createShipmentAPI;
