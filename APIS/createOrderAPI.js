import axios from "axios";
import moment from "moment";
import Session from "../models/sessionModel.js";
import BookShipment from "../models/bookShipmentModel.js";

const createOrderAPI = async (phone) => {
  try {
    console.log(`📦 Creating order for phone: ${phone}`);

    // Fetch the session data for the given phone number
    let session = await Session.findOne({ phone });
    let booking = await BookShipment.findOne({ phone });

    const reqData = {};

    reqData.approx_weight =
      booking?.boxDetails?.reduce(
        (sum, box) => sum + (box.weightPerBox || 0) * (box.count || 0),
        0
      ) || 0;
    reqData.is_insured = false;
    reqData.is_to_pay = booking?.paymentMode === 2 ? true : false;
    reqData.to_pay_amount =
      booking?.paymentMode === 2 ? booking?.codAmount : null;
    reqData.pickup_location_id = Number(booking?.selectedPickupId);

    reqData.pickup_person_name = "";
    if (Array.isArray(booking?.pickupWarehouses)) {
      const selectedPickup = booking.pickupWarehouses.find(
        (w) => String(w.id) === String(booking?.selectedPickupId)
      );
      reqData.pickup_person_name = selectedPickup?.contact_person_name || "";
    }

    reqData.pickup_person_email = "";
    if (Array.isArray(booking?.pickupWarehouses)) {
      const selectedPickup = booking.pickupWarehouses.find(
        (w) => String(w.id) === String(booking?.selectedPickupId)
      );
      reqData.pickup_person_email = selectedPickup?.contact_person_email || null;
    }

    reqData.pickup_person_contact_no = "";
    if (Array.isArray(booking?.pickupWarehouses)) {
      const selectedPickup = booking.pickupWarehouses.find(
        (w) => String(w.id) === String(booking?.selectedPickupId)
      );
      reqData.pickup_person_contact_no =
        selectedPickup?.contact_person_contact_no || "";
    }

    reqData.drop_location_id = Number(booking?.selectedDropId);
    reqData.drop_person_name = "";
    if (Array.isArray(booking?.dropWarehouses)) {
      const selectedDrop = booking.dropWarehouses.find(
        (w) => String(w.id) === String(booking?.selectedDropId)
      );
      reqData.drop_person_name = selectedDrop?.contact_person_name || "";
    }

    reqData.drop_person_email = "";
    if (Array.isArray(booking?.dropWarehouses)) {
      const selectedDrop = booking.dropWarehouses.find(
        (w) => String(w.id) === String(booking?.selectedDropId)
      );
      reqData.drop_person_email = selectedDrop?.contact_person_email || null;
    }

    reqData.drop_person_contact_no = "";
    if (Array.isArray(booking?.dropWarehouses)) {
      const selectedDrop = booking.dropWarehouses.find(
        (w) => String(w.id) === String(booking?.selectedDropId)
      );
      reqData.drop_person_contact_no =
        selectedDrop?.contact_person_contact_no || "";
    }

    reqData.client_id = Number(session?.clientId) || null;

    let order_ready_date = null;
    // if (booking?.orderReadyDate) {
    //   // Convert YYYY-MM-DD to ISO string with time set to 00:00:00
    //   order_ready_date = new Date(`${booking.orderReadyDate}T00:00:00Z`);
    // }

    // const currentTimePlus5 = moment().add(5, "minutes").format("HH:mm:ss");
    // const combinedDateTime2 = `${order_ready_date}T${currentTimePlus5}`;
    // let pickup_date_time = moment(combinedDateTime2).toISOString();

    if (booking?.orderReadyDate) {
      const baseDate = moment(booking.orderReadyDate, "YYYY-MM-DD").startOf(
        "day"
      );
      const pickup_date_time = baseDate.add(5, "minutes").toISOString();
      reqData.pickup_date_time = pickup_date_time;
    } else {
      reqData.pickup_date_time = null;
    }
    let unitom = booking?.unitOfMeasurement || "CM";
    //reqData.pickup_date_time = pickup_date_time;
    if (Array.isArray(booking?.boxDetails)) {
      reqData.mps_details = booking.boxDetails.map((box) => {
        // Convert to CM if unitom is 'IN'
        let length = box.length || 0;
        let width = box.width || 0;
        let height = box.height || 0;
        if (unitom === "IN") {
          length = length * 2.54;
          width = width * 2.54;
          height = height * 2.54;
        }
        return {
          weight: box.weightPerBox || 0,
          height,
          length,
          width,
          units: box.count || 0,
          unit: "CM",
        };
      });
    } else {
      reqData.mps_details.boxes = [];
    }
    reqData.no_of_units = booking?.boxDetails?.reduce(
      (sum, box) => sum + (box.count || 0),
      0
    );
    reqData.package_content = booking?.productName || "";
    reqData.invoice_number = booking?.invoiceNumber || "";
    reqData.invoice_date = moment(booking?.invoiceDate).format("YYYY-MM-DD");
    reqData.invoice_value = Number(booking?.invoiceValue )|| 0;
    reqData.mode_name = booking?.shipmentMode || "surface";
    reqData.is_cod = booking?.paymentMode === 1 ? true : false;
    reqData.cod_payment_mode = "cash";
    reqData.shipment_payment_type = String(booking?.paymentMode || "0");
    reqData.shipment_payment_amount = booking?.codAmount || 0;
    reqData.attached_docs = [];
    reqData.is_auto_assigned = false;
    reqData.is_created_via_clone = false;
    reqData.pickup_slots = [];
    reqData.delivery_slots = [];
    reqData.is_abd_scheduled = false;
    reqData.pickup_appointment_date = null;
    reqData.special_delivery_type = String(booking?.specialDeliveryType || "");
    reqData.hsn_code = booking?.hsnCode || "";
    reqData.product_name = booking?.productName || "";
    reqData.self_drop = booking?.selfDrop || false;
    reqData.rov_mode = booking?.rovInsuranceType || "rov_owner";

    console.log("📦 Create-Order request data:", reqData);
    let token = session?.token || "";
    // 🟢 Now call the external API:
    const response = await axios.post(
      "https://admin.logistos.in/seller/orders/",
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

    console.log("✅ Create Order response:", response.data);
    booking = await BookShipment.findOneAndUpdate(
      { phone },
      { orderId: response.data.id },
      { new: true }
    );

    return response.data;
  } catch (err) {
    console.error("❌ Error in createOrderAPI:", err.message);
    throw err;
  }
};

export default createOrderAPI;
