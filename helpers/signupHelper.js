import axios from "axios";
import FormData from "form-data";

export async function signupUser(data) {
    try {
        const formData = new FormData();
        for (const key in data) {
            formData.append(key, data[key]);
        }

        const response = await axios.post(
            "https://admin.logistos.in/api/client/seller-self-onboarding/",
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    Accept: "application/json, text/plain, */*",
                },
            }
        );

        return response.data;
    } catch (err) {
        console.error("❌ Signup error:", err.response?.data || err.message);
        throw err;
    }
}
