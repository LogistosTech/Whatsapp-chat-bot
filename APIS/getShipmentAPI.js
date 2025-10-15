import axios from "axios";
import Session from "../models/sessionModel.js";
import BookShipment from "../models/bookShipmentModel.js";


const getShipmentAPI = async (phone) => {
  try {

    console.log(`📦 Fetching shipment data for phone: ${phone}`);
    
    // Fetch the session data for the given phone number
    const session = await Session.findOne({ phone });
    const booking = await BookShipment.findOne({ phone });

   
    let reqData = {};
    reqData.pickup_pin =  "";
    
    if (Array.isArray(booking?.pickupWarehouses)) {
    const selectedPickup = booking.pickupWarehouses.find(
      w => String(w.id) === String(booking?.selectedPickupId)
    );
      reqData.pickup_pin = selectedPickup?.address?.pincode || "";
    }


    reqData.drop_pin = "";

    //reqData.from_city = "";
    if (Array.isArray(booking?.dropWarehouses)) {
    const selectedDrop = booking.dropWarehouses.find(
      w => String(w.id) === String(booking?.selectedDropId)
    );
      reqData.drop_pin = selectedDrop?.address?.pincode || "";
    }


    reqData.mode_name = booking?.shipmentMode || "";

    reqData.from_city = "";
    if (Array.isArray(booking?.pickupWarehouses)) {
    const selectedPickup = booking.pickupWarehouses.find(
      w => String(w.id) === String(booking?.selectedPickupId)
    );
      reqData.from_city = selectedPickup?.address?.city || "";
    }

    reqData.to_city = "";
    if (Array.isArray(booking?.dropWarehouses)) {
      const selectedDrop = booking.dropWarehouses.find(
        w =>String(w.id) === String(booking?.selectedDropId)
      );
      reqData.to_city = selectedDrop?.address?.city || "";
    }
    
    reqData.from_state =""
    if (Array.isArray(booking?.pickupWarehouses)) {
      const selectedPickup = booking.pickupWarehouses.find(
        w => String(w.id) === String(booking?.selectedPickupId)
      );
      reqData.from_state = selectedPickup?.address?.state || "";
    }

    reqData.to_state =""
    if (Array.isArray(booking?.dropWarehouses)) {
      const selectedDrop = booking.dropWarehouses.find(
        w => String(w.id) === String(booking?.selectedDropId)
      );
      reqData.to_state = selectedDrop?.address?.state || "";
    }

       
    reqData.quantity = Array.isArray(booking?.boxDetails)
      ? booking.boxDetails.reduce((sum, box) => sum + (box.count || 0), 0)
      : 0;
    reqData.weight = booking?.boxDetails?.reduce(
      (sum, box) => sum + (box.weightPerBox || 0) * (box.count || 0),
      0
    ) || 0;
    reqData.invoice_value = booking?.invoiceValue || 0;
    reqData.is_to_pay = booking?.paymentMode===2 ? true : false;
    reqData.is_insured = false;
    reqData.is_cod = booking?.paymentMode===1 ? true : false;
    reqData.rov_mode = booking?.rovInsuranceType;
    reqData.shipment_payment_type = String(booking?.paymentMode || "0"); // 0: Prepaid, 1: COD, 2: TO-PAY
    reqData.shipment_payment_amount = booking?.codAmount || 0;
    reqData.cod_amount = booking?.codAmount || 0;
    reqData.self_drop = booking?.selfDrop || false;
    reqData.special_delivery_type = String(booking?.specialDeliveryType || "");
    reqData.courier_type = booking?.courier_type || "B2B"; // Default to B2B if not set
    let unitom = booking?.unitOfMeasurement || "CM";
    reqData.mps_details = {};
    if (Array.isArray(booking?.boxDetails)) {
    reqData.mps_details = booking.boxDetails.map(box => {
      // Convert to CM if unitom is 'IN'
      let length = box.length || 0;
      let width = box.width || 0;
      let height = box.height || 0;
      if (unitom === 'IN') {
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
        unit: "CM"
      };
    });
    } else {
      reqData.mps_details.boxes = [];
    }

    //console.log('📦 Shipment request data:', reqData); 

    let token = session?.token || "";
    // 🟢 Now call the external API:
    const response = await axios.post(
      "https://admin.logistos.in/seller/get_shipment_charges/",
      reqData,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "Authorization": `Bearer ${token}`, 
          "Origin": "https://portal.logistos.in",
          "Referer": "https://portal.logistos.in/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        }
      }
    );

    //console.log("✅ Shipment charges response:", response.data);

    return response.data;
  } catch (error) {
    console.error("❌ Error fetching shipment data:", error);
    throw error;
  }
};

export default getShipmentAPI;
