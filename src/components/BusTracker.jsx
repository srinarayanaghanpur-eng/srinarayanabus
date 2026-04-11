import { useState, useEffect, useRef, useMemo } from "react";
import storageService, { StorageKeys } from "../config/storage";
import { auth } from "../config/firebase";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import imageCompression from 'browser-image-compression';

const BUSES = [
  { label: "TS25T7838", driver: "D. Ajay" },
  { label: "TG25T0545", driver: "Ramu" },
  { label: "TS25T7840", driver: "Prashanth" },
  { label: "TS25T8070", driver: "Tirupathi" },
  { label: "TG25T0215", driver: "Suresh" },
];

const TABS = ["Dashboard", "Diesel", "Maintenance", "Other", "Routes", "Students", "Fuel Plan", "Reports", "Settings", "Teachers"];
const DEFAULT_PIN = "1234";
const DATA_GOV_API_KEY = "YOUR_API_KEY_HERE"; // Get from https://api.data.gov.in/ - search for "Diesel Price" dataset
const DATA_GOV_RESOURCE = "9e7b9c96-0afe-4d67-9a73-1e55c1c4b8f8";

// Teachers Data
const DEFAULT_TEACHERS = [
  { id: "t001", name: "P. Shashidhara Chary", role: "Correspondent", subject: "Administration", salary: 50000, photo: null, pin: "1001" },
  { id: "t002", name: "P. Swapna Chary", role: "Principal", subject: "Administration", salary: 45000, photo: null, pin: "1002" },
  { id: "t003", name: "K. Swamy", role: "Teacher", subject: "Mathematics", salary: 30000, photo: null, pin: "1003" },
];

// School GPS coordinates (precise location) - adjust to your school's exact location
const SCHOOL_GPS = { lat: 17.6869, lng: 78.5255, radius: 150 }; // 150 meters radius for campus lock

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const TODAY = new Date().toISOString().split("T")[0];

const DEFAULT_DAILY_KM = {
  TS25T7838: 40,
  TG25T0545: 38,
  TS25T7840: 20,
  TS25T8070: 30,
  TG25T0215: 35,
};

const fmt = n => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = d => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const daysUntil = ds => Math.ceil((new Date(ds) - new Date(TODAY)) / 86400000);

const getBusDailyKm = (bus, settings, defaultKm) => {
  const configured = settings?.[bus]?.dailyKm || "";
  const fromSettings = parseFloat(configured);
  if (!isNaN(fromSettings) && fromSettings > 0) return fromSettings;
  return defaultKm[bus] || 0;
};

const getNextFuelEstimate = (bus, settings, dieselEntries, holidays, defaultKm) => {
  const entries = dieselEntries.filter(e => e.bus === bus).sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) return { label: "No previous fuel entry", info: "Save the first diesel record to estimate next fueling." };
  const last = entries[0];
  const dailyKm = getBusDailyKm(bus, settings, defaultKm);
  if (!last.mileage) return { label: "Meter readings required", info: "Enter KM before and KM after to calculate mileage." };
  if (!dailyKm) return { label: "Daily KM not set", info: "Set daily KM in Fuel Plan for this bus." };
  const nextDate = getNextFuelDate(last.date, last.liters, last.mileage, dailyKm, holidays.map(h => h.date));
  if (!nextDate) return { label: "Unable to predict", info: "Check fuel entry and try again." };
  return { label: "Next fuel due", info: `${fmtDate(nextDate)} (${daysUntil(nextDate)} days)` };
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const getNextFuelDate = (lastDate, liters, avgMileage, dailyKm, holidays) => {
  if (!liters || !avgMileage || !dailyKm) return null;
  const totalKm = parseFloat(liters) * parseFloat(avgMileage);
  let days = Math.floor(totalKm / parseFloat(dailyKm));
  let d = new Date(lastDate);
  let counted = 0;
  let safety = 0;
  while (counted < days && safety < 365) {
    d.setDate(d.getDate() + 1);
    safety++;
    if (d.getDay() === 0) continue;
    if (holidays.includes(d.toISOString().split("T")[0])) continue;
    counted++;
  }
  return d.toISOString().split("T")[0];
};

// ===== TEACHERS UTILITY FUNCTIONS =====

// Image compression: Convert large images to <=100KB with optimized quality
const compressImage = async (file) => {
  const options = {
    maxSizeMB: 0.1, // 100KB
    maxWidthOrHeight: 800,
    useWebWorker: true,
    fileType: 'image/jpeg'
  };

  try {
    const compressedFile = await imageCompression(file, options);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(compressedFile);
      reader.onload = () => resolve(reader.result);
    });
  } catch (error) {
    console.error('Image compression failed:', error);
    // Fallback to original compression if library fails
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Scale down to reduce file size
          const maxWidth = 800;
          const maxHeight = 800;
          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          // Compress with reduced quality
          const compressed = canvas.toDataURL("image/jpeg", 0.6);
          resolve(compressed);
        };
      };
    });
  }
};

// GPS Verification: Check if user is within school premises (enhanced)
const verifyGPS = async () => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: "error", message: "Geolocation not supported" });
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000 // 5 minutes
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const distance = getDistance(SCHOOL_GPS.lat, SCHOOL_GPS.lng, latitude, longitude);
        const inSchool = distance <= SCHOOL_GPS.radius;
        resolve({
          status: "success",
          inSchool,
          distance: Math.round(distance),
          accuracy: Math.round(accuracy),
          coords: { lat: latitude, lng: longitude }
        });
      },
      (error) => {
        let message = "Location access denied";
        if (error.code === error.TIMEOUT) message = "Location timeout - try again";
        if (error.code === error.POSITION_UNAVAILABLE) message = "Location unavailable";
        resolve({ status: "error", message });
      },
      options
    );
  });
};

// Calculate distance between two GPS coordinates (Haversine formula)
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Get current IST time
const getISTTime = () => {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return istTime;
};

// Check if teacher is late (smart attendance rules)
const getAttendanceStatus = () => {
  const istTime = getISTTime();
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const nineAMMinutes = 9 * 60; // 9:00 AM
  const nineFifteenAMMinutes = 9 * 60 + 15; // 9:15 AM

  if (timeInMinutes < nineAMMinutes) return "present";
  if (timeInMinutes <= nineFifteenAMMinutes) return "late";
  return "absent";
};

// Get attendance status based on today's entry
const getAttendanceStatus = (attendanceRecords, teacherId, date) => {
  const record = attendanceRecords.find(r => r.teacherId === teacherId && r.date === date);
  if (!record) return "absent";
  if (record.status === "present" || record.status === "late") return record.status;
  return "absent";
};

// Calculate CL (Casual Leave) based on attendance
const calculateCL = (attendanceRecords, teacherId, month, year) => {
  const monthRecords = attendanceRecords.filter(r => {
    const rDate = new Date(r.date);
    return rDate.getMonth() === month && rDate.getFullYear() === year && r.teacherId === teacherId;
  });
  
  let fullDayCL = 0;
  let halfDayCL = 0;
  let lateCount = 0;
  
  monthRecords.forEach(record => {
    if (record.status === "absent") fullDayCL++;
    else if (record.status === "late") lateCount++;
  });
  
  // 3+ days late = half day CL
  if (lateCount >= 3) halfDayCL = 0.5;
  
  return { fullDayCL, halfDayCL, lateCount };
};

// Calculate salary deduction
const calculateSalaryDeduction = (teacher, attendanceRecords, month, year) => {
  const { fullDayCL, halfDayCL } = calculateCL(attendanceRecords, teacher.id, month, year);
  const dailySalary = teacher.salary / 30; // Assuming 30 working days
  const fullDeduction = fullDayCL * dailySalary;
  const halfDeduction = halfDayCL * dailySalary * 0.5;
  const totalDeduction = fullDeduction + halfDeduction;
  const netSalary = teacher.salary - totalDeduction;
  
  return {
    dailySalary: dailySalary.toFixed(0),
    fullDayDeduction: fullDeduction.toFixed(0),
    halfDayDeduction: halfDeduction.toFixed(0),
    totalDeduction: totalDeduction.toFixed(0),
    netSalary: netSalary.toFixed(0),
  };
};

const generateShareCard = (entry, billImage) => {
  return new Promise(resolve => {
    const W = 800;
    const H = billImage ? 1000 : 600;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, W, 120);
    grad.addColorStop(0, "#1a237e");
    grad.addColorStop(1, "#1565c0");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 120);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText("SRI NARAYANA HIGH SCHOOL", W / 2, 48);
    ctx.font = "18px Arial";
    ctx.fillStyle = "#90caf9";
    ctx.fillText("Bus Diesel Bill Report", W / 2, 82);

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    roundRect(ctx, W - 175, 18, 155, 38, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "14px Arial";
    ctx.textAlign = "right";
    ctx.fillText(fmtDate(entry.date), W - 28, 43);

    const drawRow = (y, label, value, valColor) => {
      ctx.fillStyle = "#1e293b";
      roundRect(ctx, 40, y, W - 80, 68, 10);
      ctx.fill();
      ctx.fillStyle = "#64748b";
      ctx.font = "13px Arial";
      ctx.textAlign = "left";
      ctx.fillText(label, 68, y + 26);
      ctx.fillStyle = valColor || "#f1f5f9";
      ctx.font = "bold 22px Arial";
      ctx.fillText(value, 68, y + 54);
    };

    let y = 140;
    drawRow(y, "BUS NUMBER", entry.bus, "#60a5fa"); y += 82;
    drawRow(y, "DRIVER NAME", entry.driver, "#93c5fd"); y += 82;
    drawRow(y, "LITERS FILLED", entry.liters + " Litres", "#4ade80"); y += 82;
    drawRow(y, "PRICE PER LITRE", "Rs." + entry.pricePerLiter, "#fbbf24"); y += 82;

    ctx.fillStyle = "#14532d";
    roundRect(ctx, 40, y, W - 80, 84, 12);
    ctx.fill();
    ctx.fillStyle = "#86efac";
    ctx.font = "15px Arial";
    ctx.textAlign = "left";
    ctx.fillText("TOTAL AMOUNT PAID", 68, y + 30);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px Arial";
    ctx.fillText("Rs." + entry.total.toLocaleString("en-IN"), 68, y + 68);
    y += 100;

    if (entry.mileage) {
      ctx.fillStyle = "#064e3b";
      roundRect(ctx, 40, y, W - 80, 50, 8);
      ctx.fill();
      ctx.fillStyle = "#34d399";
      ctx.font = "bold 18px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Mileage: " + entry.mileage + " km/L", W / 2, y + 32);
      y += 66;
    }

    if (entry.note) {
      ctx.fillStyle = "#1e293b";
      roundRect(ctx, 40, y, W - 80, 46, 8);
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Note: " + entry.note, W / 2, y + 30);
      y += 62;
    }

    const finish = () => {
      ctx.fillStyle = "#334155";
      ctx.fillRect(0, H - 50, W, 50);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Sri Narayana High School - Bus Fleet Management", W / 2, H - 18);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };

    if (billImage) {
      ctx.fillStyle = "#1e293b";
      roundRect(ctx, 40, y, W - 80, 310, 12);
      ctx.fill();
      ctx.fillStyle = "#64748b";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("FUEL BILL PHOTO", W / 2, y + 28);

      const img = new Image();
      img.onload = () => {
        const iW = W - 120, iH = 260;
        const ratio = Math.min(iW / img.width, iH / img.height);
        const dW = img.width * ratio, dH = img.height * ratio;
        const dx = 40 + (iW - dW) / 2 + 20;
        ctx.drawImage(img, dx, y + 38, dW, dH);
        finish();
      };
      img.onerror = finish;
      img.src = billImage;
    } else {
      finish();
    }
  });
};

const SriLogo = () => {
  const [useFallback, setUseFallback] = useState(false);

  if (useFallback) {
    return (
      <svg width="56" height="40" viewBox="0 0 140 100" style={{ flexShrink: 0 }}>
        <rect x="6" y="20" width="128" height="52" rx="12" ry="12" fill="#facc15" stroke="#d97706" strokeWidth="4" />
        <rect x="16" y="10" width="96" height="24" rx="10" ry="10" fill="#fbbf24" />
        <rect x="20" y="28" width="24" height="18" rx="4" ry="4" fill="#ffffff" />
        <rect x="52" y="28" width="24" height="18" rx="4" ry="4" fill="#ffffff" />
        <rect x="84" y="28" width="24" height="18" rx="4" ry="4" fill="#ffffff" />
        <rect x="22" y="52" width="20" height="10" rx="4" ry="4" fill="#dc2626" />
        <rect x="52" y="52" width="20" height="10" rx="4" ry="4" fill="#dc2626" />
        <rect x="84" y="52" width="20" height="10" rx="4" ry="4" fill="#dc2626" />
        <circle cx="38" cy="80" r="12" fill="#1f2937" />
        <circle cx="38" cy="80" r="6" fill="#fbbf24" />
        <circle cx="102" cy="80" r="12" fill="#1f2937" />
        <circle cx="102" cy="80" r="6" fill="#fbbf24" />
        <rect x="110" y="36" width="8" height="24" rx="3" ry="3" fill="#1f2937" />
        <rect x="8" y="38" width="18" height="18" rx="4" ry="4" fill="#1f2937" />
        <text x="40" y="43" fontSize="16" fontWeight="800" fill="#1f2937">SRI</text>
      </svg>
    );
  }

  return (
    <img
      src="/logo.png"
      alt="SNHS logo"
      onError={() => setUseFallback(true)}
      style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 8, background: "#fff", flexShrink: 0 }}
    />
  );
};

const PinModal = ({ title, onSuccess, onCancel, adminPin }) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleKey = k => {
    if (k === "DEL") { setPin(p => p.slice(0, -1)); setError(""); return; }
    if (pin.length >= 4) return;
    const np = pin + k;
    setPin(np);
    if (np.length === 4) {
      if (np === adminPin) { setTimeout(() => onSuccess(), 100); }
      else { setTimeout(() => { setPin(""); setError("Wrong PIN. Try again."); }, 300); }
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0f1929", borderRadius: 20, padding: 28, width: "100%", maxWidth: 320, border: "1px solid #1e3a5f", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>Admin Access Required</div>
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 20 }}>{title}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: 20 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ width: 18, height: 18, borderRadius: "50%", background: i < pin.length ? "#3b82f6" : "#1e3a5f", border: "2px solid", borderColor: i < pin.length ? "#3b82f6" : "#334155" }} />
          ))}
        </div>
        {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "DEL"].map((k, i) => {
            if (k === "") return <div key={i} />;
            return (
              <button key={k} onClick={() => handleKey(k)}
                style={{ padding: "16px 0", borderRadius: 12, border: "1px solid #1e3a5f", background: k === "DEL" ? "#1e3a5f" : "#151f35", color: k === "DEL" ? "#ef4444" : "#f1f5f9", fontSize: k === "DEL" ? 13 : 20, fontWeight: 700, cursor: "pointer" }}>
                {k}
              </button>
            );
          })}
        </div>
        <button onClick={onCancel} style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #334155", background: "transparent", color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
};

const BillCapture = ({ value, onChange }) => {
  const fileRef = useRef();
  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onChange(ev.target.result);
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFile} />
      {value ? (
        <div style={{ position: "relative", marginBottom: 10 }}>
          <img src={value} alt="bill" style={{ width: "100%", borderRadius: 10, border: "1px solid #1e3a5f", maxHeight: 180, objectFit: "cover" }} />
          <button onClick={() => onChange(null)} style={{ position: "absolute", top: 8, right: 8, background: "rgba(239,68,68,0.9)", border: "none", borderRadius: 20, color: "#fff", fontSize: 12, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>Remove</button>
          <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 600, marginTop: 4 }}>✅ Bill photo attached</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <button onClick={() => fileRef.current.click()}
            style={{ padding: "14px 8px", borderRadius: 10, border: "1px dashed #1e3a5f", background: "#070c18", color: "#60a5fa", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            📷 Camera
          </button>
          <button onClick={() => { fileRef.current.removeAttribute("capture"); fileRef.current.click(); setTimeout(() => fileRef.current.setAttribute("capture", "environment"), 500); }}
            style={{ padding: "14px 8px", borderRadius: 10, border: "1px dashed #1e3a5f", background: "#070c18", color: "#60a5fa", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
            🖼️ Gallery
          </button>
        </div>
      )}
    </div>
  );
};

const ShareBtn = ({ entry }) => {
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      const dataUrl = await generateShareCard(entry, entry.billImage || null);
      const textMsg = "SRI NARAYANA HIGH SCHOOL\nBus: " + entry.bus + "\nDriver: " + entry.driver + "\nDate: " + fmtDate(entry.date) + "\nDiesel: " + entry.liters + "L @ Rs." + entry.pricePerLiter + "/L\nTOTAL: Rs." + entry.total + (entry.mileage ? "\nMileage: " + entry.mileage + " km/L" : "") + (entry.note ? "\nNote: " + entry.note : "");

      if (navigator.share) {
        try {
          const blob = await fetch(dataUrl).then(r => r.blob());
          const file = new File([blob], "fuel_bill_" + entry.bus + "_" + entry.date + ".jpg", { type: "image/jpeg" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: "Fuel Bill - " + entry.bus, text: textMsg, files: [file] });
            setSharing(false);
            return;
          }
        } catch (e) {}
      }

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "fuel_bill_" + entry.bus + "_" + entry.date + ".jpg";
      a.click();
      setTimeout(() => {
        window.open("https://wa.me/?text=" + encodeURIComponent(textMsg), "_blank");
      }, 600);
    } catch (err) {
      const textMsg = "Bus: " + entry.bus + " | Driver: " + entry.driver + " | Rs." + entry.total;
      window.open("https://wa.me/?text=" + encodeURIComponent(textMsg), "_blank");
    }
    setSharing(false);
  };

  return (
    <button onClick={handleShare} disabled={sharing}
      style={{ background: sharing ? "#14532d" : "#16a34a", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, cursor: "pointer", padding: "6px 12px", marginTop: 4, fontWeight: 700 }}>
      {sharing ? "⏳..." : "📤 Share"}
    </button>
  );
};

const BarChart = ({ data, color }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ fontSize: 8, color: "#475569", fontWeight: 600 }}>{d.value > 0 ? (d.value / 1000).toFixed(0) + "k" : ""}</div>
          <div style={{ width: "100%", background: color || "#3b82f6", borderRadius: "3px 3px 0 0", height: Math.max((d.value / max) * 65, d.value > 0 ? 4 : 0) + "px" }} />
          <div style={{ fontSize: 8, color: "#334155", fontWeight: 600 }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
};

const LineChart = ({ data, color }) => {
  if (!data || data.length < 2) {
    return <div style={{ textAlign: "center", color: "#334155", fontSize: 12, padding: 20 }}>Add more diesel entries with KM to see chart</div>;
  }
  const vals = data.map(d => d.y);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const W = 300, H = 80, P = 10;
  const pts = data.map((d, i) => {
    const x = P + (i / (data.length - 1)) * (W - P * 2);
    const y = P + (1 - (d.y - min) / range) * (H - P * 2);
    return x + "," + y;
  }).join(" ");

  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: H }}>
      <polyline points={pts} fill="none" stroke={color || "#34d399"} strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = P + (i / (data.length - 1)) * (W - P * 2);
        const y = P + (1 - (d.y - min) / range) * (H - P * 2);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="4" fill={color || "#34d399"} />
            <text x={x} y={y - 8} textAnchor="middle" fill="#64748b" fontSize="8">{d.y}</text>
          </g>
        );
      })}
    </svg>
  );
};

export default function BusTracker() {
  const [tab, setTab]             = useState("Dashboard");
  const [isAdmin, setIsAdmin]     = useState(false);
  const [showPin, setShowPin]     = useState(false);
  const [pinAction, setPinAction] = useState(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [newPin, setNewPin]       = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMsg, setPinMsg]       = useState("");
  const [toast, setToast]         = useState("");
  const [viewBill, setViewBill]   = useState(null);
  const [loading, setLoading]     = useState(true);

  const [dieselEntries, setDieselEntries] = useState([]);
  const [maintEntries,  setMaintEntries]  = useState([]);
  const [otherEntries,  setOtherEntries]  = useState([]);
  const [routeEntries,  setRouteEntries]  = useState([]);
  const [studentRoutes, setStudentRoutes] = useState([]);
  const [holidays,      setHolidays]      = useState([]);
  const [khataInfo,     setKhataInfo]     = useState({ isPaid: false, paidDate: null });
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [paidKhataEntries, setPaidKhataEntries] = useState([]);
  const [showKhataPaidHistory, setShowKhataPaidHistory] = useState(false);
  
  const [buses, setBuses] = useState(BUSES);
  const [defaultKm, setDefaultKm] = useState(DEFAULT_DAILY_KM);
  const [adminPin, setAdminPin] = useState('4927');
  const [accountantPin, setAccountantPin] = useState('6300');
  const [newAdminPin, setNewAdminPin] = useState('');
  const [newAccountantPin, setNewAccountantPin] = useState('');

  const [busSettings,   setBusSettings]   = useState(
    buses.reduce((acc, b) => ({ ...acc, [b.label]: { dailyKm: String(DEFAULT_DAILY_KM[b.label] || ""), tankLiters: "" } }), {})
  );

  const [dieselForm, setDieselForm] = useState({ bus: buses[0]?.label || "", date: TODAY, liters: "", pricePerLiter: "", kmBefore: "", kmAfter: "", note: "", billImage: null, paymentMethod: "" });
  const [maintForm,  setMaintForm]  = useState({ bus: buses[0]?.label || "", date: TODAY, type: "", amount: "", note: "" });
  const [otherForm,  setOtherForm]  = useState({ bus: buses[0]?.label || "", date: TODAY, type: "", amount: "", note: "" });
  const [routeForm,  setRouteForm]  = useState({ bus: buses[0]?.label || "", date: TODAY, route: "", kmStart: "", kmEnd: "", note: "" });
  const [stuForm,    setStuForm]    = useState({ bus: buses[0]?.label || "", route: "", count: "", villages: "" });
  const [editStuId,  setEditStuId]  = useState(null);
  const [newHoliday, setNewHoliday] = useState({ date: TODAY, name: "" });
  const [reportMonth, setReportMonth] = useState(new Date().getMonth());
  const [reportYear,  setReportYear]  = useState(new Date().getFullYear());
  const [chartBus,    setChartBus]    = useState(buses[0]?.label || "");
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [fetchedPrice,  setFetchedPrice]  = useState(null);
  const [priceError, setPriceError] = useState("");

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [userRole, setUserRole] = useState(null); // 'admin' or 'accountant'

  // PIN to Role mapping
  const ROLE_PINS = {
    '4927': 'admin',
    '6300': 'accountant'
  };
  const [visibleEntries, setVisibleEntries] = useState(10); // Lazy load entries

  // ===== TEACHERS STATE =====
  const [teachers, setTeachers] = useState(DEFAULT_TEACHERS);
  const [teacherAttendance, setTeacherAttendance] = useState([]);
  const [teacherSalaries, setTeacherSalaries] = useState({});
  const [isTeacherMode, setIsTeacherMode] = useState(false);
  const [loggedInTeacher, setLoggedInTeacher] = useState(null);
  const [teacherPin, setTeacherPin] = useState('');
  const [teacherLoginError, setTeacherLoginError] = useState('');
  const [teacherPhotoRef, setTeacherPhotoRef] = useState(null);
  const [showTeacherCamera, setShowTeacherCamera] = useState(false);
  const [teacherAttendanceMonth, setTeacherAttendanceMonth] = useState(new Date().getMonth());
  const [teacherAttendanceYear, setTeacherAttendanceYear] = useState(new Date().getFullYear());
  const [attendanceFilter, setAttendanceFilter] = useState('all'); // 'all', 'present', 'late', 'absent'
  const [showTeacherSalaryReport, setShowTeacherSalaryReport] = useState(false);
  const [loginMode, setLoginMode] = useState('bus'); // 'bus' or 'teacher' - for main login screen

  // Auth state listener - check localStorage for saved sessions
  useEffect(() => {
    const savedRole = localStorage.getItem('userRole');
    if (savedRole) {
      setUser({ role: savedRole });
      setUserRole(savedRole);
    }
    setAuthLoading(false);
  }, []);

  // Load all data from storage: localStorage first, then Firebase sync in background
  useEffect(() => {
    const parseLocal = key => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.warn(`LocalStorage parse failed for ${key}:`, error);
        return null;
      }
    };

    const loadLocalData = () => {
      const d = parseLocal(StorageKeys.DIESEL);
      if (d) setDieselEntries(d);

      const m = parseLocal(StorageKeys.MAINTENANCE);
      if (m) setMaintEntries(m);

      const o = parseLocal(StorageKeys.OTHER);
      if (o) setOtherEntries(o);

      const r = parseLocal(StorageKeys.ROUTES);
      if (r) setRouteEntries(r);

      const p = parseLocal(StorageKeys.PIN);
      if (p) setAdminPin(p);

      const s = parseLocal(StorageKeys.STUDENTS);
      if (s) setStudentRoutes(s);

      const h = parseLocal(StorageKeys.HOLIDAYS);
      if (h) setHolidays(h);

      const bs = parseLocal(StorageKeys.BUS_SETTINGS);
      if (bs) setBusSettings(bs);

      const b = parseLocal(StorageKeys.BUSES);
      if (b) setBuses(b);

      const dk = parseLocal(StorageKeys.DEFAULT_KM);
      if (dk) setDefaultKm(dk);

      const ki = parseLocal("khataInfo");
      if (ki) setKhataInfo(ki);

      const pke = parseLocal("paidKhataEntries");
      if (pke) setPaidKhataEntries(pke);

      // Load teachers data
      const t = parseLocal(StorageKeys.TEACHERS);
      if (t) setTeachers(t);
      else setTeachers(DEFAULT_TEACHERS);

      // Load teacher attendance
      const ta = parseLocal(StorageKeys.TEACHER_ATTENDANCE);
      if (ta) setTeacherAttendance(ta);

      // Load teacher salaries
      const ts = parseLocal(StorageKeys.TEACHER_SALARIES);
      if (ts) setTeacherSalaries(ts);
    };

    const syncFirebaseData = async () => {
      if (!storageService.isFirebaseAvailable()) return;
      try {
        const all = await storageService.loadAll();
        if (all[StorageKeys.DIESEL]) setDieselEntries(all[StorageKeys.DIESEL]);
        if (all[StorageKeys.MAINTENANCE]) setMaintEntries(all[StorageKeys.MAINTENANCE]);
        if (all[StorageKeys.OTHER]) setOtherEntries(all[StorageKeys.OTHER]);
        if (all[StorageKeys.ROUTES]) setRouteEntries(all[StorageKeys.ROUTES]);
        if (all[StorageKeys.PIN]) setAdminPin(all[StorageKeys.PIN]);
        if (all[StorageKeys.STUDENTS]) setStudentRoutes(all[StorageKeys.STUDENTS]);
        if (all[StorageKeys.HOLIDAYS]) setHolidays(all[StorageKeys.HOLIDAYS]);
        if (all[StorageKeys.BUS_SETTINGS]) setBusSettings(all[StorageKeys.BUS_SETTINGS]);
        if (all[StorageKeys.BUSES]) setBuses(all[StorageKeys.BUSES]);
        if (all[StorageKeys.DEFAULT_KM]) setDefaultKm(all[StorageKeys.DEFAULT_KM]);
        if (all[StorageKeys.TEACHERS]) setTeachers(all[StorageKeys.TEACHERS]);
        if (all[StorageKeys.TEACHER_ATTENDANCE]) setTeacherAttendance(all[StorageKeys.TEACHER_ATTENDANCE]);
        if (all[StorageKeys.TEACHER_SALARIES]) setTeacherSalaries(all[StorageKeys.TEACHER_SALARIES]);
        showToast("📱 Firebase sync completed");
      } catch (error) {
        console.warn("Firebase sync failed:", error);
      }
    };

    const loadData = async () => {
      try {
        loadLocalData();
        showToast("📱 Data loaded from localStorage");
      } catch (error) {
        console.error("Error loading local data:", error);
        showToast("Error loading data");
      } finally {
        setLoading(false);
      }

      await syncFirebaseData();
    };

    loadData();
  }, []);

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const requireAdmin = action => {
    if (isAdmin) { executeAction(action); return; }
    setPinAction(action); setShowPin(true);
  };

  const executeAction = async action => {
    setShowPin(false); setIsAdmin(true);
    if (!action) return;
    const type = action.type;
    
    if (type === "delete_diesel") {
      const u = dieselEntries.filter(e => e.id !== action.id);
      setDieselEntries(u);
      await storageService.save(StorageKeys.DIESEL, u);
      showToast("Deleted");
    } else if (type === "delete_maint") {
      const u = maintEntries.filter(e => e.id !== action.id);
      setMaintEntries(u);
      await storageService.save(StorageKeys.MAINTENANCE, u);
      showToast("Deleted");
    } else if (type === "delete_other") {
      const u = otherEntries.filter(e => e.id !== action.id);
      setOtherEntries(u);
      await storageService.save(StorageKeys.OTHER, u);
      showToast("Deleted");
    } else if (type === "delete_route") {
      const u = routeEntries.filter(e => e.id !== action.id);
      setRouteEntries(u);
      await storageService.save(StorageKeys.ROUTES, u);
      showToast("Deleted");
    } else if (type === "delete_student") {
      const u = studentRoutes.filter(e => e.id !== action.id);
      setStudentRoutes(u);
      await storageService.save(StorageKeys.STUDENTS, u);
      showToast("Deleted");
    } else if (type === "delete_holiday") {
      const u = holidays.filter(h => h.date !== action.hdate);
      setHolidays(u);
      await storageService.save(StorageKeys.HOLIDAYS, u);
      showToast("Holiday removed");
    } else if (type === "open_admin") {
      setShowAdminPanel(true);
    }
  };

  const lockAdmin = () => { setIsAdmin(false); showToast("Admin locked"); };

  const changePin = async () => {
    if (newPin.length !== 4 || isNaN(newPin)) { setPinMsg("PIN must be 4 digits"); return; }
    if (newPin !== confirmPin) { setPinMsg("PINs do not match"); return; }
    setAdminPin(newPin);
    await storageService.save(StorageKeys.PIN, newPin);
    setNewPin(""); setConfirmPin(""); setPinMsg("PIN changed!");
    setTimeout(() => setPinMsg(""), 2000);
  };

  const fetchDieselPrice = async () => {
    setFetchingPrice(true); setFetchedPrice(null);

    // Simple market price suggestion (90-100 range)
    const currentPrices = {
      "2024-01": 95.50, "2024-02": 96.20, "2024-03": 97.80, "2024-04": 98.50,
      "2024-05": 99.20, "2024-06": 100.10, "2024-07": 101.50, "2024-08": 102.80,
      "2024-09": 103.20, "2024-10": 104.50, "2024-11": 105.80, "2024-12": 106.20,
      "2025-01": 107.50, "2025-02": 108.90, "2025-03": 109.50, "2025-04": 110.20,
      "2025-05": 111.80, "2025-06": 112.50, "2026-01": 113.20, "2026-02": 114.80,
      "2026-03": 115.50, "2026-04": 116.20
    };

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let suggestedPrice = currentPrices[monthKey];

    // If no current month data, use last available or default to 95-100 range
    if (!suggestedPrice) {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
      suggestedPrice = currentPrices[lastMonthKey] || 98.50; // Default fallback
    }

    // Ensure price stays within 90-103 range as required
    if (suggestedPrice > 103) suggestedPrice = 90 + Math.random() * 13; // 90-103
    if (suggestedPrice < 90) suggestedPrice = 90 + Math.random() * 13; // 90-103

    // Round to 2 decimal places
    suggestedPrice = Math.round(suggestedPrice * 100) / 100;

    setFetchedPrice({
      price: suggestedPrice,
      date: now.toISOString().split('T')[0],
      source: "market suggestion"
    });
    setDieselForm(f => ({ ...f, pricePerLiter: String(suggestedPrice) }));
    showToast(`Suggested: Rs.${suggestedPrice}/L (current market range: 90-103)`);

    setFetchingPrice(false);
  };

  const saveDiesel = async () => {
    const { bus, date, liters, pricePerLiter, kmBefore, kmAfter, note, billImage, paymentMethod } = dieselForm;
    if (!liters || !pricePerLiter || !date || !paymentMethod) return showToast("Please select payment method: Cash/UPI/Khata!");
    
    // Validate price range
    const price = parseFloat(pricePerLiter);
    if (price < 90 || price > 103) {
      showToast("Price must be between 90-103 rupees only!");
      return;
    }
    
    const total = parseFloat((parseFloat(liters) * parseFloat(pricePerLiter)).toFixed(2));
    const km = kmAfter && kmBefore ? parseFloat(kmAfter) - parseFloat(kmBefore) : null;
    const mileage = km && liters ? (km / parseFloat(liters)).toFixed(2) : null;
    const driver = buses.find(b => b.label === bus)?.driver || "";
    const entry = { id: Date.now(), bus, driver, date, liters: parseFloat(liters), pricePerLiter: parseFloat(pricePerLiter), total, kmBefore: kmBefore || null, kmAfter: kmAfter || null, km, mileage, note, billImage: billImage || null, paymentMethod };
    const updated = [entry, ...dieselEntries];
    setDieselEntries(updated);
    await storageService.save(StorageKeys.DIESEL, updated);
    setDieselForm({ bus: buses[0]?.label || "", date: TODAY, liters: "", pricePerLiter: "", kmBefore: "", kmAfter: "", note: "", billImage: null, paymentMethod: "" });
    setFetchedPrice(null); showToast("Diesel saved!");
    const settings = busSettings[bus] || {};
    const dailyKm = parseFloat(settings.dailyKm) || 0;
    if (mileage && dailyKm) {
      const next = getNextFuelDate(date, liters, mileage, dailyKm, holidays.map(h => h.date));
      if (next) showToast("Next fuel due: " + fmtDate(next));
    }
  };

  const validateDieselPrice = (value) => {
    const price = parseFloat(value);
    if (isNaN(price) || value === "") return "";
    if (price < 90 || price > 103) {
      return "Enter between 90-103 only";
    }
    return "";
  };

  const handlePriceChange = (value) => {
    setDieselForm({ ...dieselForm, pricePerLiter: value });
    setPriceError(validateDieselPrice(value));
  };

  const handlePriceBlur = () => {
    const error = validateDieselPrice(dieselForm.pricePerLiter);
    setPriceError(error);
    if (error) {
      // Clear the invalid price
      setDieselForm({ ...dieselForm, pricePerLiter: "" });
      setPriceError("");
    }
  };

  const saveMaint = async () => {
    if (!maintForm.type || !maintForm.amount) return showToast("Fill required fields!");
    const driver = buses.find(b => b.label === maintForm.bus)?.driver || "";
    const entry = { id: Date.now(), ...maintForm, driver, amount: parseFloat(maintForm.amount) };
    const updated = [entry, ...maintEntries];
    setMaintEntries(updated);
    await storageService.save(StorageKeys.MAINTENANCE, updated);
    setMaintForm({ bus: buses[0]?.label || "", date: TODAY, type: "", amount: "", note: "" });
    showToast("Saved!");
  };

  const saveOther = async () => {
    if (!otherForm.type || !otherForm.amount) return showToast("Fill required fields!");
    const driver = buses.find(b => b.label === otherForm.bus)?.driver || "";
    const entry = { id: Date.now(), ...otherForm, driver, amount: parseFloat(otherForm.amount) };
    const updated = [entry, ...otherEntries];
    setOtherEntries(updated);
    await storageService.save(StorageKeys.OTHER, updated);
    setOtherForm({ bus: BUSES[0].label, date: TODAY, type: "", amount: "", note: "" });
    showToast("Saved!");
  };

  const saveRoute = async () => {
    if (!routeForm.route || !routeForm.kmStart || !routeForm.kmEnd) return showToast("Fill required fields!");
    const km = parseFloat(routeForm.kmEnd) - parseFloat(routeForm.kmStart);
    if (km <= 0) return showToast("End KM must be greater than Start KM");
    const driver = BUSES.find(b => b.label === routeForm.bus)?.driver || "";
    const entry = { id: Date.now(), ...routeForm, driver, km: parseFloat(km.toFixed(1)), kmStart: parseFloat(routeForm.kmStart), kmEnd: parseFloat(routeForm.kmEnd) };
    const updated = [entry, ...routeEntries];
    setRouteEntries(updated);
    await storageService.save(StorageKeys.ROUTES, updated);
    setRouteForm({ bus: BUSES[0].label, date: TODAY, route: "", kmStart: "", kmEnd: "", note: "" });
    showToast("Route saved!");
  };

  const saveStudentRoute = async () => {
    if (!stuForm.route || !stuForm.count) return showToast("Fill route name and count!");
    const driver = BUSES.find(b => b.label === stuForm.bus)?.driver || "";
    const entry = { id: editStuId || Date.now(), bus: stuForm.bus, driver, route: stuForm.route, count: parseInt(stuForm.count), villages: stuForm.villages };
    const updated = editStuId ? studentRoutes.map(e => e.id === editStuId ? entry : e) : [...studentRoutes, entry];
    setStudentRoutes(updated);
    await storageService.save(StorageKeys.STUDENTS, updated);
    setEditStuId(null);
    setStuForm({ bus: BUSES[0].label, route: "", count: "", villages: "" });
    showToast(editStuId ? "Updated!" : "Added!");
  };

  const saveBusSettings = async () => {
    await storageService.save(StorageKeys.BUS_SETTINGS, busSettings);
    showToast("Settings saved!");
  };

  const addHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name) return showToast("Enter date and name!");
    if (holidays.find(h => h.date === newHoliday.date)) return showToast("Already added!");
    const updated = [...holidays, { ...newHoliday }].sort((a, b) => a.date.localeCompare(b.date));
    setHolidays(updated);
    await storageService.save(StorageKeys.HOLIDAYS, updated);
    setNewHoliday({ date: TODAY, name: "" });
    showToast("Holiday added!");
  };

  const exportCSV = () => {
    // Calculate account-wise totals
    const cashTotal = dieselEntries.filter(e => e.paymentMethod === "Cash").reduce((sum, e) => sum + (e.total || 0), 0);
    const upiTotal = dieselEntries.filter(e => e.paymentMethod === "UPI").reduce((sum, e) => sum + (e.total || 0), 0);
    const khataTotal = dieselEntries.filter(e => e.paymentMethod === "Khata").reduce((sum, e) => sum + (e.total || 0), 0);
    const isFirebaseAvailable = storageService.isFirebaseAvailable();
    
    const rows = [
      ["Sri Narayana High School Bus Tracker Report"],
      ["Generated On", TODAY],
      ["Firebase Status", isFirebaseAvailable ? "Connected" : "Not configured"],
      [],
      ["ACCOUNT SUMMARY"],
      ["Account","Total Amount","Status"],
      ["💵 CASH PAID", fmt(cashTotal), "Settled"],
      ["📱 UPI PAID", fmt(upiTotal), "Settled"],
      ["📖 KHATA", fmt(khataTotal), khataInfo.isPaid ? `Settled - Paid on ${khataInfo.paidDate}` : "Outstanding - Due to Pump"],
      [],
      ["DIESEL TRANSACTIONS - PAYMENT METHOD WISE"],
      ["Type","Bus","Driver","Date","Liters","Price/L","Amount","Payment Method","KM","Mileage","Note","Bill"]
    ];

    dieselEntries.forEach(e => rows.push(["Diesel",e.bus,e.driver,e.date,e.liters,e.pricePerLiter,e.total,e.paymentMethod||"",e.km||"",e.mileage||"",e.note,e.billImage?"Yes":"No"]));
    
    rows.push([]);
    rows.push(["MAINTENANCE ENTRIES"]);
    rows.push(["Type","Bus","Driver","Date","Amount","Details","Note"]);
    maintEntries.forEach(e  => rows.push(["Maintenance",e.bus,e.driver,e.date,e.amount,e.type,e.note]));
    
    rows.push([]);
    rows.push(["OTHER EXPENSES"]);
    rows.push(["Type","Bus","Driver","Date","Amount","Details","Note"]);
    otherEntries.forEach(e  => rows.push(["Other",e.bus,e.driver,e.date,e.amount,e.type,e.note]));
    
    rows.push([]);
    rows.push(["ROUTE TRACKING"]);
    rows.push(["Type","Bus","Driver","Date","Route","KM","Note"]);
    routeEntries.forEach(e  => rows.push(["Route",e.bus,e.driver,e.date,e.route,e.km,e.note]));

    rows.push([], ["SUMMARY","","","","","","",""]);
    rows.push(["Diesel Total (Cash)", fmt(cashTotal)]);
    rows.push(["Diesel Total (UPI)", fmt(upiTotal)]);
    rows.push(["Diesel Total (Khata)", fmt(khataTotal), "DUE TO PUMP"]);
    rows.push(["Diesel Grand Total", fmt(totalDiesel)]);
    rows.push(["Maintenance Total", fmt(totalMaint)]);
    rows.push(["Other Total", fmt(totalOther)]);
    rows.push(["Grand Total (All Expenses)", fmt(grandTotal)]);

    const csv = rows.map(r => r.map(cell => `"${cell}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = "SNHS_Report_" + TODAY + ".csv";
    a.click();
    showToast("CSV Downloaded!");
  };

  const handleLogin = () => {
    if (pin === adminPin) {
      setUser({ role: 'admin' });
      setUserRole('admin');
      setIsAdmin(true);
      localStorage.setItem('userRole', 'admin');
      setPin('');
      setLoginError('');
      showToast('✅ Logged in as Admin');
    } else if (pin === accountantPin) {
      setUser({ role: 'accountant' });
      setUserRole('accountant');
      setIsAdmin(false);
      localStorage.setItem('userRole', 'accountant');
      setPin('');
      setLoginError('');
      showToast('✅ Logged in as Accountant');
    } else {
      setLoginError('Invalid PIN');
    }
  };

  const handleLogout = () => {
    setUser(null);
    setUserRole(null);
    setIsAdmin(false);
    localStorage.removeItem('userRole');
    showToast('Logged out');
  };

  // ===== TEACHER HANDLERS  =====
  const handleTeacherLogin = () => {
    const pin = teacherPin.trim();
    const teacher = teachers.find(t => t.pin === pin);
    if (teacher) {
      setLoggedInTeacher(teacher);
      setIsTeacherMode(true);
      setTeacherPin('');
      setTeacherLoginError('');
      showToast(`✅ Welcome ${teacher.name}`);
      localStorage.setItem('loggedInTeacher', JSON.stringify(teacher));
    } else {
      setTeacherLoginError('Invalid Teacher PIN');
    }
  };

  const handleTeacherLogout = () => {
    setLoggedInTeacher(null);
    setIsTeacherMode(false);
    setTeacherPin('');
    localStorage.removeItem('loggedInTeacher');
    showToast('Teacher logged out');
  };

  const sendWhatsAppNotification = async (teacher, attendanceRecord) => {
    try {
      // Call Firebase Cloud Function for WhatsApp
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const functions = getFunctions();
      const sendWhatsApp = httpsCallable(functions, 'sendWhatsAppNotification');

      await sendWhatsApp({
        teacherId: teacher.id,
        teacherName: teacher.name,
        status: attendanceRecord.status,
        date: attendanceRecord.date,
        time: attendanceRecord.time
      });

      console.log('WhatsApp notification sent for absent teacher');
    } catch (error) {
      console.error('WhatsApp notification failed:', error);
      // Don't block attendance flow if WhatsApp fails
    }
  };

  const captureTeacherPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if already submitted today
    const todayRecord = teacherAttendance.find(a => a.teacherId === loggedInTeacher.id && a.date === TODAY);
    if (todayRecord) {
      setTeacherLoginError('❌ Attendance already marked for today');
      showToast('❌ Already marked attendance today');
      return;
    }

    try {
      setShowTeacherCamera(false);
      showToast('🔄 Checking location...');

      // Step 1: Verify GPS location
      const gpsResult = await verifyGPS();
      if (gpsResult.status === "error") {
        setTeacherLoginError(`❌ ${gpsResult.message}`);
        showToast('❌ Location check failed');
        return;
      }

      if (!gpsResult.inSchool) {
        setTeacherLoginError(`❌ You are ${gpsResult.distance}m outside campus area`);
        showToast('❌ Not in school premises');
        return;
      }

      showToast('🔄 Compressing image...');

      // Step 2: Compress image
      const compressedPhoto = await compressImage(file);

      // Step 3: Apply smart attendance rules
      const status = getAttendanceStatus();

      // Step 4: Create attendance record
      const attendanceRecord = {
        id: Date.now().toString(),
        teacherId: loggedInTeacher.id,
        teacherName: loggedInTeacher.name,
        date: TODAY,
        time: getISTTime().toLocaleString('en-IN'),
        status: status,
        photo: compressedPhoto,
        locationData: {
          lat: gpsResult.coords.lat,
          lng: gpsResult.coords.lng,
          distance: gpsResult.distance,
          accuracy: gpsResult.accuracy
        },
        timestamp: new Date().toISOString()
      };

      // Step 5: Save attendance
      const updatedAttendance = [...teacherAttendance, attendanceRecord];
      setTeacherAttendance(updatedAttendance);
      await storageService.save(StorageKeys.TEACHER_ATTENDANCE, updatedAttendance);

      // Step 6: Trigger WhatsApp for absent only
      if (status === "absent") {
        await sendWhatsAppNotification(loggedInTeacher, attendanceRecord);
      }

      showToast(`✅ Attendance marked as ${status.toUpperCase()}`);
    } catch (error) {
      console.error('Attendance capture error:', error);
      showToast('❌ Error processing attendance');
    }
  };

  // Load teacher attendance from storage
  useEffect(() => {
    const loadTeacherData = async () => {
      const savedAttendance = await storageService.load(StorageKeys.TEACHER_ATTENDANCE);
      if (savedAttendance) setTeacherAttendance(savedAttendance);

      const savedTeachers = await storageService.load(StorageKeys.TEACHERS);
      const teachersData = savedTeachers || DEFAULT_TEACHERS;
      if (savedTeachers) setTeachers(savedTeachers);

      // Check if teacher was previously logged in
      const savedTeacher = localStorage.getItem('loggedInTeacher');
      if (savedTeacher) {
        const teacher = JSON.parse(savedTeacher);
        // Use loaded teachersData instead of closure state
        if (teachersData.find(t => t.id === teacher.id)) {
          setLoggedInTeacher(teacher);
          setIsTeacherMode(true);
        }
      }
    };
    loadTeacherData();
  }, []);

  if (authLoading) {
    return (
      <div style={{ fontFamily: "'Segoe UI',sans-serif", background: "#070c18", minHeight: "100vh", color: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Checking authentication...</div>
        </div>
      </div>
    );
  }

  if (!user && !isTeacherMode) {
    return (
      <div style={{ fontFamily: "'Segoe UI',sans-serif", background: "#070c18", minHeight: "100vh", color: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <h1 style={{color: '#2563eb', marginBottom: 30, fontSize: 48, fontWeight: 900, letterSpacing: 2}}>SRI NARAYANA HIGH SCHOOL</h1>
        
        {/* Login Mode Tabs */}
        <div style={{display: 'flex', gap: 10, marginBottom: 20}}>
          <button onClick={() => setLoginMode('bus')} style={{padding: '10px 20px', borderRadius: 6, border: 'none', background: loginMode === 'bus' ? '#2563eb' : '#334155', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14}}>
            🚌 Bus Tracker
          </button>
          <button onClick={() => setLoginMode('teacher')} style={{padding: '10px 20px', borderRadius: 6, border: 'none', background: loginMode === 'teacher' ? '#2563eb' : '#334155', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14}}>
            👨‍🏫 Teachers
          </button>
        </div>
        
        {/* Bus Tracker Login */}
        {loginMode === 'bus' && (
          <div style={{background: '#1a2a3a', padding: '30px', borderRadius: '12px', maxWidth: '300px', width: '100%', border: '1px solid #334155'}}>
            <div style={{marginBottom: 20}}>
              <label style={{color: '#cbd5e1', fontSize: 12, fontWeight: 600}}>Enter Your PIN:</label>
              <input 
                type="password" 
                placeholder="Enter PIN" 
                value={pin} 
                onChange={(e) => setPin(e.target.value)} 
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                style={{margin: '12px 0', padding: '12px', borderRadius: 5, border: '1px solid #475569', background: '#0d1525', color: '#fff', width: '100%', boxSizing: 'border-box', fontSize: 16}}
              />
            </div>
            
            <button onClick={handleLogin} style={{width: '100%', margin: '10px 0', padding: '12px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14}}>
              Login
            </button>
            
            {loginError && <p style={{color: '#ef4444', marginTop: 10, fontSize: 12, textAlign: 'center'}}>{loginError}</p>}
          </div>
        )}

        {/* Teacher  Login */}
        {loginMode === 'teacher' && (
          <div style={{background: '#1a2a3a', padding: '30px', borderRadius: '12px', maxWidth: '300px', width: '100%', border: '1px solid #334155'}}>
            <div style={{marginBottom: 20}}>
              <label style={{color: '#cbd5e1', fontSize: 12, fontWeight: 600}}>Enter Your PIN:</label>
              <input 
                type="password" 
                placeholder="Enter PIN" 
                value={teacherPin} 
                onChange={(e) => setTeacherPin(e.target.value)} 
                onKeyPress={(e) => e.key === 'Enter' && handleTeacherLogin()}
                style={{margin: '12px 0', padding: '12px', borderRadius: 5, border: '1px solid #475569', background: '#0d1525', color: '#fff', width: '100%', boxSizing: 'border-box', fontSize: 16}}
              />
            </div>
            
            <button onClick={handleTeacherLogin} style={{width: '100%', margin: '10px 0', padding: '12px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14}}>
              Login as Teacher
            </button>
            
            {teacherLoginError && <p style={{color: '#ef4444', marginTop: 10, fontSize: 12, textAlign: 'center'}}>{teacherLoginError}</p>}
            
            <div style={{marginTop: 16, fontSize: 12, color: '#64748b', background: '#0d1525', padding: 12, borderRadius: 6}}>
              <div style={{fontWeight: 700, marginBottom: 8}}>Demo Teacher PINs:</div>
              {teachers.map(t => <div key={t.id}>📌 {t.name}: {t.pin}</div>)}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "'Segoe UI',sans-serif", background: "#070c18", minHeight: "100vh", color: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Loading your data...</div>
          <div style={{ fontSize: 12, color: "#475569" }}>Syncing with Firebase & localStorage</div>
        </div>
      </div>
    );
  }

  // ===== TEACHER MODE INTERFACE =====
  if (isTeacherMode && loggedInTeacher) {
    const todayAttendance = teacherAttendance.find(a => a.teacherId === loggedInTeacher.id && a.date === TODAY);
    const monthAttendance = teacherAttendance.filter(a => {
      const aDate = new Date(a.date);
      const matchesDate = a.teacherId === loggedInTeacher.id && aDate.getMonth() === teacherAttendanceMonth && aDate.getFullYear() === teacherAttendanceYear;
      const matchesFilter = attendanceFilter === 'all' || a.status === attendanceFilter;
      return matchesDate && matchesFilter;
    });
    const { fullDayCL, halfDayCL, lateCount } = calculateCL(teacherAttendance, loggedInTeacher.id, teacherAttendanceMonth, teacherAttendanceYear);
    const salaryInfo = calculateSalaryDeduction(loggedInTeacher, teacherAttendance, teacherAttendanceMonth, teacherAttendanceYear);

    return (
      <div style={{ fontFamily: "'Segoe UI',sans-serif", background: "#070c18", minHeight: "100vh", color: "#f1f5f9", padding: 16 }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", borderRadius: 12, padding: 20, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>Welcome</div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>{loggedInTeacher.name}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{loggedInTeacher.role} • {loggedInTeacher.subject}</div>
            </div>
            <button onClick={handleTeacherLogout} style={{ background: "#dc2626", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700 }}>
              Logout
            </button>
          </div>

          {/* Attendance Status */}
          <div style={{ background: "#1a2a3a", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #334155" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📅 Today's Attendance</div>
            {todayAttendance ? (
              <div style={{ background: todayAttendance.status === 'present' ? "rgba(34,197,94,0.1)" : "rgba(249,115,22,0.1)", borderRadius: 8, padding: 12, border: `1px solid ${todayAttendance.status === 'present' ? '#22c55e' : '#f97316'}` }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Status</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: todayAttendance.status === 'present' ? '#4ade80' : '#fb923c', marginBottom: 8 }}>
                  {todayAttendance.status === 'present' ? '✅ PRESENT' : '⏰ LATE'}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Time: {todayAttendance.time}</div>
              </div>
            ) : (
              <div style={{ background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: 16, border: "1px solid #ef4444", textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f87171", marginBottom: 12 }}>❌ Not Marked</div>
                <label style={{ display: "block", marginTop: 12 }}>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={captureTeacherPhoto}
                    style={{ display: "none" }}
                  />
                  <div style={{ background: "#2563eb", color: "#fff", padding: "12px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 700, textAlign: "center" }}>
                    📸 Mark Attendance Now
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Monthly Statistics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "#1a2a3a", borderRadius: 12, padding: 16, border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Working Days</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#60a5fa" }}>{monthAttendance.length}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Present: {monthAttendance.filter(a => a.status === 'present').length} | Late: {lateCount}</div>
            </div>
            <div style={{ background: "#1a2a3a", borderRadius: 12, padding: 16, border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Casual Leave (CL)</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#f97316" }}>{fullDayCL + halfDayCL}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Full: {fullDayCL} | Half: {halfDayCL.toFixed(1)}</div>
            </div>
          </div>

          {/* Salary Information */}
          <div style={{ background: "#1a2a3a", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #334155" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>💰 Salary Calculation</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>{<div style={{ fontSize: 12, color: "#94a3b8" }}>Gross Salary</div>}<div style={{ fontSize: 18, fontWeight: 700, color: "#4ade80" }}>{fmt(loggedInTeacher.salary)}</div></div>
              <div>{<div style={{ fontSize: 12, color: "#94a3b8" }}>Daily Rate</div>}<div style={{ fontSize: 18, fontWeight: 700, color: "#60a5fa" }}>{fmt(salaryInfo.dailySalary)}</div></div>
              <div>{<div style={{ fontSize: 12, color: "#94a3b8" }}>Full Day Deduction</div>}<div style={{ fontSize: 18, fontWeight: 700, color: "#fb923c" }}>-{fmt(salaryInfo.fullDayDeduction)}</div></div>
              <div>{<div style={{ fontSize: 12, color: "#94a3b8" }}>Half Day Deduction</div>}<div style={{ fontSize: 18, fontWeight: 700, color: "#fb923c" }}>-{fmt(salaryInfo.halfDayDeduction)}</div></div>
              <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #334155", paddingTop: 12, marginTop: 12 }}>
                {<div style={{ fontSize: 12, color: "#94a3b8" }}>Net Salary This Month</div>}
                <div style={{ fontSize: 24, fontWeight: 900, color: "#34d399" }}>{fmt(salaryInfo.netSalary)}</div>
              </div>
            </div>
          </div>

          {/* Attendance Details */}
          <div style={{ background: "#1a2a3a", borderRadius: 12, padding: 20, border: "1px solid #334155" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📊 This Month's Attendance</div>

            {/* Filter Controls */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <button onClick={() => setAttendanceFilter('all')} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: attendanceFilter === 'all' ? '#2563eb' : '#334155', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>All ({teacherAttendance.filter(a => { const aDate = new Date(a.date); return a.teacherId === loggedInTeacher.id && aDate.getMonth() === teacherAttendanceMonth && aDate.getFullYear() === teacherAttendanceYear; }).length})</button>
              <button onClick={() => setAttendanceFilter('present')} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: attendanceFilter === 'present' ? '#22c55e' : '#334155', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Present ({monthAttendance.filter(a => a.status === 'present').length})</button>
              <button onClick={() => setAttendanceFilter('late')} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: attendanceFilter === 'late' ? '#f97316' : '#334155', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Late ({monthAttendance.filter(a => a.status === 'late').length})</button>
              <button onClick={() => setAttendanceFilter('absent')} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: attendanceFilter === 'absent' ? '#ef4444' : '#334155', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Absent ({monthAttendance.filter(a => a.status === 'absent').length})</button>
            </div>
            {monthAttendance.length > 0 ? (
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {monthAttendance.map((record, idx) => (
                  <div key={idx} style={{ background: "#0d1525", borderRadius: 8, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", borderLeft: `4px solid ${record.status === 'present' ? '#22c55e' : '#f97316'}` }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{fmtDate(record.date)}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{record.time}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: record.status === 'present' ? '#4ade80' : '#fb923c' }}>
                      {record.status === 'present' ? '✅ Present' : '⏰ Late'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#64748b", textAlign: "center", padding: 20 }}>No attendance records this month</div>
            )}
          </div>

          {/* Monthly Calendar View */}
          <div style={{ background: "#1a2a3a", borderRadius: 12, padding: 20, border: "1px solid #334155" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📅 Monthly Calendar</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 16 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textAlign: "center", padding: 8 }}>{day}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {(() => {
                const firstDay = new Date(teacherAttendanceYear, teacherAttendanceMonth, 1).getDay();
                const daysInMonth = new Date(teacherAttendanceYear, teacherAttendanceMonth + 1, 0).getDate();
                const days = [];

                // Empty cells for days before first day of month
                for (let i = 0; i < firstDay; i++) {
                  days.push(<div key={`empty-${i}`} style={{ padding: 8 }}></div>);
                }

                // Days of the month
                for (let day = 1; day <= daysInMonth; day++) {
                  const dateStr = `${teacherAttendanceYear}-${String(teacherAttendanceMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const record = teacherAttendance.find(a => a.teacherId === loggedInTeacher.id && a.date === dateStr);
                  const status = record?.status;

                  days.push(
                    <div key={day} style={{
                      padding: 8,
                      textAlign: "center",
                      borderRadius: 6,
                      background: status === 'present' ? 'rgba(34,197,94,0.2)' : status === 'late' ? 'rgba(249,115,22,0.2)' : status === 'absent' ? 'rgba(239,68,68,0.2)' : '#0d1525',
                      border: status ? '1px solid rgba(255,255,255,0.1)' : 'none',
                      color: status ? '#e2e8f0' : '#64748b',
                      fontSize: 12,
                      fontWeight: status ? 600 : 400
                    }}>
                      {day}
                      {status && <div style={{ fontSize: 8, marginTop: 2 }}>
                        {status === 'present' ? '✓' : status === 'late' ? '⏰' : '✗'}
                      </div>}
                    </div>
                  );
                }

                return days;
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalDiesel  = useMemo(() => dieselEntries.reduce((s, e) => s + e.total, 0), [dieselEntries]);
  const totalMaint   = useMemo(() => maintEntries.reduce((s, e) => s + e.amount, 0), [maintEntries]);
  const totalOther   = useMemo(() => otherEntries.reduce((s, e) => s + e.amount, 0), [otherEntries]);
  const grandTotal   = useMemo(() => totalDiesel + totalMaint + totalOther, [totalDiesel, totalMaint, totalOther]);
  const totalKmAll   = useMemo(() => routeEntries.reduce((s, e) => s + e.km, 0), [routeEntries]);
  const totalStudents = useMemo(() => studentRoutes.reduce((s, r) => s + r.count, 0), [studentRoutes]);

  const dieselEstimate = useMemo(() => getNextFuelEstimate(dieselForm.bus, busSettings, dieselEntries, holidays, defaultKm), [dieselForm.bus, busSettings, dieselEntries, holidays, defaultKm]);
  const currentBusDailyKm = useMemo(() => getBusDailyKm(dieselForm.bus, busSettings, defaultKm), [dieselForm.bus, busSettings, defaultKm]);

  const busStats = useMemo(() => BUSES.map(({ label, driver }) => {
    const de = dieselEntries.filter(e => e.bus === label);
    const mileageArr = de.filter(e => e.mileage);
    return {
      label, driver,
      diesel:   de.reduce((s, e) => s + e.total, 0),
      maint:    maintEntries.filter(e => e.bus === label).reduce((s, e) => s + e.amount, 0),
      other:    otherEntries.filter(e => e.bus === label).reduce((s, e) => s + e.amount, 0),
      liters:   de.reduce((s, e) => s + e.liters, 0),
      totalKm:  routeEntries.filter(e => e.bus === label).reduce((s, e) => s + e.km, 0),
      students: studentRoutes.filter(r => r.bus === label).reduce((s, r) => s + r.count, 0),
      avgMileage: mileageArr.length ? (mileageArr.reduce((s, e) => s + parseFloat(e.mileage), 0) / mileageArr.length).toFixed(1) : null,
      lastDiesel: de.sort((a, b) => b.date.localeCompare(a.date))[0] || null,
    };
  }), [dieselEntries, maintEntries, otherEntries, routeEntries, studentRoutes]);

  const fuelPredictions = useMemo(() => busStats.map(b => {
    const settings = busSettings[b.label] || {};
    const dailyKm = parseFloat(settings.dailyKm) || 0;
    if (!b.lastDiesel || !b.avgMileage || !dailyKm) return { ...b, nextFuelDate: null, daysLeft: null, urgency: "unknown", dailyKm };
    const holidayDates = holidays.map(h => h.date);
    const nextDate = getNextFuelDate(b.lastDiesel.date, b.lastDiesel.liters, b.avgMileage, dailyKm, holidayDates);
    const dl = nextDate ? daysUntil(nextDate) : null;
    const urgency = dl === null ? "unknown" : dl <= 1 ? "critical" : dl <= 3 ? "warning" : "ok";
    return { ...b, nextFuelDate: nextDate, daysLeft: dl, urgency, dailyKm };
  }), [busStats, busSettings, holidays]);

  const monthKey = e => { const d = new Date(e.date); return { m: d.getMonth(), y: d.getFullYear() }; };
  const monthlyData = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = new Date(reportYear, reportMonth - i, 1);
    const m = d.getMonth(), y = d.getFullYear();
    const f = e => { const k = monthKey(e); return k.m === m && k.y === y; };
    const diesel = dieselEntries.filter(f).reduce((s, e) => s + e.total, 0);
    const maint  = maintEntries.filter(f).reduce((s, e) => s + e.amount, 0);
    const other  = otherEntries.filter(f).reduce((s, e) => s + e.amount, 0);
    return { label: MONTHS[m], month: m, year: y, diesel, maint, other, total: diesel + maint + other };
  }).reverse(), [reportYear, reportMonth, dieselEntries, maintEntries, otherEntries]);

  const selFilter = e => { const k = monthKey(e); return k.m === reportMonth && k.y === reportYear; };
  const selDiesel = useMemo(() => dieselEntries.filter(selFilter).reduce((s, e) => s + e.total, 0), [dieselEntries, reportMonth, reportYear]);
  const selMaint  = useMemo(() => maintEntries.filter(selFilter).reduce((s, e) => s + e.amount, 0), [maintEntries, reportMonth, reportYear]);
  const selOther  = useMemo(() => otherEntries.filter(selFilter).reduce((s, e) => s + e.amount, 0), [otherEntries, reportMonth, reportYear]);
  const chartData = useMemo(() => dieselEntries.filter(e => e.bus === chartBus && e.mileage).slice(0, 8).reverse().map((e, i) => ({ x: i, y: parseFloat(e.mileage) })), [dieselEntries, chartBus]);
  const navMonth = dir => { let m = reportMonth + dir, y = reportYear; if (m > 11) { m = 0; y++; } else if (m < 0) { m = 11; y--; } setReportMonth(m); setReportYear(y); };

  const firebaseAvailable = storageService.isFirebaseAvailable();
  const urgencyColor = u => u === "critical" ? "#ef4444" : u === "warning" ? "#fb923c" : u === "ok" ? "#4ade80" : "#64748b";
  const urgencyBg    = u => u === "critical" ? "rgba(239,68,68,0.1)" : u === "warning" ? "rgba(251,146,60,0.1)" : u === "ok" ? "rgba(74,222,128,0.07)" : "#070c18";
  const urgencyBorder= u => u === "critical" ? "#ef4444" : u === "warning" ? "#fb923c" : u === "ok" ? "#4ade80" : "#1e3a5f";

  const BusSelect = ({ value, onChange }) => (
    <select style={S.select} value={value} onChange={e => onChange(e.target.value)}>
      {BUSES.map(b => <option key={b.label} value={b.label}>{b.label} — {b.driver}</option>)}
    </select>
  );

  const DelBtn = ({ dtype, id }) => (
    <button onClick={() => requireAdmin({ type: "delete_" + dtype, id })}
      style={{ background: "none", border: "1px solid " + (isAdmin ? "#ef4444" : "#334155"), borderRadius: 8, color: isAdmin ? "#ef4444" : "#475569", fontSize: 12, cursor: "pointer", padding: "4px 10px", marginTop: 4, whiteSpace: "nowrap" }}>
      {isAdmin ? "Del" : "Del"}
    </button>
  );

  const HolDelBtn = ({ hdate }) => (
    <button onClick={() => requireAdmin({ type: "delete_holiday", hdate })}
      style={{ background: "none", border: "1px solid " + (isAdmin ? "#ef4444" : "#334155"), borderRadius: 6, color: isAdmin ? "#ef4444" : "#475569", fontSize: 11, cursor: "pointer", padding: "3px 8px" }}>
      {isAdmin ? "Del" : "Del"}
    </button>
  );

  const S = {
    app:    { fontFamily: "'Segoe UI',sans-serif", background: "#0d1525", minHeight: "100vh", color: "#e2e8f0", paddingBottom: 80 },
    header: { background: "linear-gradient(135deg,#1f3a5f,#2d5a96)", padding: "20px 20px 18px", boxShadow: "0 18px 40px rgba(0,0,0,0.35)" },
    hRow:   { display: "flex", alignItems: "center", justifyContent: "space-between" },
    hLeft:  { display: "flex", alignItems: "center", gap: 14 },
    sName:  { fontSize: 18, fontWeight: 900, color: "#ffffff", lineHeight: 1.2 },
    sSub:   { fontSize: 12, color: "#dbeafe", marginTop: 4 },
    aBadge: a => ({ background: a ? "rgba(74,222,128,0.18)" : "rgba(239,68,68,0.18)", border: "1px solid " + (a ? "#4ade80" : "#ef4444"), borderRadius: 22, padding: "7px 16px", fontSize: 12, color: a ? "#4ade80" : "#f87171", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }),
    tabs:   { display: "flex", overflowX: "auto", background: "#1a2a3a", padding: "12px 12px", gap: 10, position: "sticky", top: 0, zIndex: 10, borderBottom: "1px solid rgba(100,116,139,0.2)" },
    tab:    a => ({ padding: "14px 18px", borderRadius: 28, border: a ? "1px solid rgba(96,165,250,0.35)" : "1px solid transparent", cursor: "pointer", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", background: a ? "#2563eb" : "rgba(100,116,139,0.12)", color: a ? "#fff" : "#cbd5e1" }),
    body:   { padding: 18 },
    card:   { background: "#1a2a3a", borderRadius: 18, padding: 18, marginBottom: 16, border: "1px solid rgba(148,163,184,0.15)", boxShadow: "0 12px 30px rgba(0,0,0,0.3)" },
    sec:    { fontSize: 15, fontWeight: 800, color: "#f1f5f9", marginBottom: 14 },
    lbl:    { fontSize: 11, color: "#94a3b8", marginBottom: 6, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
    input:  { width: "100%", background: "#111823", border: "1px solid rgba(100,116,139,0.25)", borderRadius: 10, padding: "13px 14px", color: "#e2e8f0", fontSize: 14, boxSizing: "border-box", outline: "none" },
    select: { width: "100%", background: "#111823", border: "1px solid rgba(100,116,139,0.25)", borderRadius: 10, padding: "13px 14px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" },
    mb:     { marginBottom: 14 },
    row2:   { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
    btn:    bg => ({ width: "100%", padding: 16, borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 15, background: bg || "#2563eb", color: "#fff", marginTop: 8, boxShadow: "0 12px 28px rgba(37,99,235,0.15)" }),
    oBtn:   color => ({ width: "100%", padding: 14, borderRadius: 14, border: "1px solid " + color, cursor: "pointer", fontWeight: 700, fontSize: 13, background: "transparent", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }),
    calc:   { background: "rgba(37,99,235,0.12)", borderRadius: 12, padding: "14px 16px", marginBottom: 12 },
    sg:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 },
    stat:   bg => ({ background: bg, borderRadius: 16, padding: "18px 14px", textAlign: "center", border: "1px solid rgba(100,116,139,0.15)" }),
    sval:   { fontSize: 20, fontWeight: 900, color: "#f1f5f9" },
    slbl:   { fontSize: 10, color: "#94a3b8", marginTop: 4, fontWeight: 700, letterSpacing: 0.5 },
    bCard:  { background: "#111823", borderRadius: 16, padding: 16, marginBottom: 12, border: "1px solid rgba(100,116,139,0.15)" },
    bTop:   { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    bNum:   { fontSize: 13, fontWeight: 800, color: "#60a5fa" },
    dBadge: { background: "rgba(96,165,250,0.15)", borderRadius: 9999, padding: "4px 12px", fontSize: 11, color: "#60a5fa", fontWeight: 700 },
    bRow:   { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#cbd5e1", marginBottom: 6 },
    bVal:   { color: "#e2e8f0", fontWeight: 700 },
    bTot:   { display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(100,116,139,0.2)", paddingTop: 10, marginTop: 6 },
    hItem:  { background: "#111823", borderRadius: 14, padding: 14, marginBottom: 10, border: "1px solid rgba(100,116,139,0.15)" },
    badge:  cat => ({ display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5, background: cat === "Diesel" ? "#1d4ed8" : cat === "Maint" ? "#7c2d12" : cat === "Route" ? "#0f766e" : cat === "Stu" ? "#5b21b6" : "#14532d", color: "#fff" }),
    hBus:   { fontSize: 13, color: "#60a5fa", fontWeight: 700 },
    hDrv:   { fontSize: 11, color: "#94a3b8", marginBottom: 3 },
    hDtl:   { fontSize: 12, color: "#cbd5e1" },
    hDate:  { fontSize: 10, color: "#94a3b8", marginTop: 3 },
    hAmt:   { fontSize: 17, fontWeight: 900, color: "#4ade80" },
    sRow:   { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(100,116,139,0.15)", fontSize: 13 },
    toast:  { position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#1a2a3a", color: "#fff", padding: "10px 22px", borderRadius: 22, fontWeight: 700, fontSize: 13, border: "1px solid rgba(56,189,248,0.25)", zIndex: 999, boxShadow: "0 12px 40px rgba(0,0,0,0.35)", whiteSpace: "nowrap" },
    lkBan:  { background: "rgba(37,99,235,0.12)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 12 },
    apanel: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 900, overflowY: "auto", padding: 20 },
    apInner:{ background: "#1a2a3a", borderRadius: 22, padding: 26, maxWidth: 420, margin: "0 auto", border: "1px solid rgba(100,116,139,0.15)" },
  };

  // Main JSX - Dashboard and all tabs
  return (
    <div style={S.app}>
      {toast && <div style={S.toast}>{toast}</div>}

      {showPin && (
        <PinModal
          title={pinAction && pinAction.type === "open_admin" ? "Enter PIN to access Admin Panel" : "Enter Admin PIN to delete"}
          adminPin={adminPin}
          onSuccess={() => executeAction(pinAction)}
          onCancel={() => { setShowPin(false); setPinAction(null); }}
        />
      )}

      {viewBill && (
        <div onClick={() => setViewBill(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 2000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Tap anywhere to close</div>
          <img src={viewBill} alt="bill" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 12, border: "1px solid #1e3a5f" }} />
        </div>
      )}

      {showAdminPanel && (
        <div style={S.apanel}>
          <div style={S.apInner}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#4ade80" }}>Admin Panel</div>
              <button onClick={() => setShowAdminPanel(false)} style={{ background: "#1e3a5f", border: "none", color: "#94a3b8", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700 }}>Close</button>
            </div>
            <div style={{ background: "#070c18", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #1e3a5f" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Change Admin PIN</div>
              <div style={S.mb}><label style={S.lbl}>New PIN (4 digits)</label><input type="number" placeholder="4 digits" style={S.input} value={newPin} onChange={e => setNewPin(e.target.value.slice(0, 4))} /></div>
              <div style={S.mb}><label style={S.lbl}>Confirm PIN</label><input type="number" placeholder="Confirm" style={S.input} value={confirmPin} onChange={e => setConfirmPin(e.target.value.slice(0, 4))} /></div>
              {pinMsg && <div style={{ fontSize: 12, color: pinMsg.includes("changed") ? "#4ade80" : "#ef4444", marginBottom: 10, fontWeight: 600 }}>{pinMsg}</div>}
              <button style={S.btn("#1565c0")} onClick={changePin}>Update PIN</button>
            </div>
            <div style={{ background: "#070c18", borderRadius: 12, padding: 16, border: "1px solid #1e3a5f" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Staff Permissions</div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.8 }}>✅ Add entries &nbsp; ✅ Capture bill photos<br />✅ Share to WhatsApp &nbsp; 🔒 Cannot delete</div>
            </div>
            <button onClick={() => { setShowAdminPanel(false); lockAdmin(); }} style={{ ...S.btn("#7c2d12"), marginTop: 16 }}>Lock Admin and Exit</button>
          </div>
        </div>
      )}

      <div style={S.header}>
        <div style={S.hRow}>
          <div style={S.hLeft}>
            <SriLogo />
            <div>
              <div style={S.sName}>SRI NARAYANA HIGH SCHOOL</div>
              <div style={S.sSub}>Bus Fleet Expense Tracker</div>
            </div>
          </div>
          <div>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <div style={{fontSize: 11, color: '#94a3b8', textAlign: 'right'}}>
                <div style={{color: userRole === 'admin' ? '#4ade80' : '#fbbf24'}}>
                  {userRole === 'admin' ? '👨‍💼 Admin' : '🧮 Accountant'}
                </div>
              </div>
              <button onClick={handleLogout} style={{background: '#dc2626', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 11}}>
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={S.tabs}>
        {TABS.map(t => {
          // Role-based tab access
          if (userRole === 'accountant' && ['Maintenance', 'Routes', 'Students', 'Fuel Plan', 'Settings'].includes(t)) {
            return null; // Hide tabs for accountant
          }
          return <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{t}</button>;
        })}
      </div>

      <div style={S.body}>
        <div style={{ ...S.lkBan, ...(isAdmin ? { borderColor: "#14532d", background: "rgba(20,83,45,0.2)" } : {}) }}>
          <span style={{ fontSize: 20 }}>{isAdmin ? "✅" : "🔒"}</span>
          <div>
            <div style={{ color: isAdmin ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: 12 }}>{isAdmin ? "Admin Mode Active" : "Staff Mode"}</div>
            <div style={{ color: "#475569", fontSize: 11 }}>{isAdmin ? "Full access enabled" : "Can add, capture bills and share"}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: firebaseAvailable ? "#4ade80" : "#ef4444", marginBottom: 14 }}>
          Firebase Status: {firebaseAvailable ? "Connected" : "Disconnected"}
        </div>

        {/* DASHBOARD TAB */}
        {tab === "Dashboard" && (
          <div>
            <div style={S.sg}>
              <div style={S.stat("linear-gradient(135deg,#1e3a8a,#1d4ed8)")}><div style={S.sval}>{fmt(totalDiesel)}</div><div style={S.slbl}>DIESEL</div></div>
              <div style={S.stat("linear-gradient(135deg,#7c2d12,#9a3412)")}><div style={S.sval}>{fmt(totalMaint)}</div><div style={S.slbl}>MAINTENANCE</div></div>
              <div style={S.stat("linear-gradient(135deg,#14532d,#166534)")}><div style={S.sval}>{fmt(totalOther)}</div><div style={S.slbl}>OTHER</div></div>
              <div style={S.stat("linear-gradient(135deg,#4c1d95,#6d28d9)")}><div style={S.sval}>{totalStudents}</div><div style={S.slbl}>STUDENTS</div></div>
            </div>
            <div style={{ ...S.card, textAlign: "center", background: "linear-gradient(135deg,#4c1d95,#6d28d9)" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 700 }}>GRAND TOTAL SPENT</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: "#fff", marginTop: 4 }}>{fmt(grandTotal)}</div>
            </div>

            {fuelPredictions.filter(f => f.urgency === "critical" || f.urgency === "warning").length > 0 && (
              <div style={S.card}>
                <div style={S.sec}>Fuel Alerts</div>
                {fuelPredictions.filter(f => f.urgency === "critical" || f.urgency === "warning").map(f => (
                  <div key={f.label} style={{ background: urgencyBg(f.urgency), border: "1px solid " + urgencyBorder(f.urgency), borderRadius: 10, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#60a5fa", fontSize: 13 }}>{f.label}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{f.driver}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: urgencyColor(f.urgency) }}>{f.urgency === "critical" ? "FUEL TODAY!" : f.daysLeft + " days left"}</div>
                      {f.nextFuelDate && <div style={{ fontSize: 10, color: "#64748b" }}>{fmtDate(f.nextFuelDate)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={S.card}>
              <div style={S.sec}>Bus-wise Summary</div>
              {busStats.map(b => (
                <div key={b.label} style={S.bCard}>
                  <div style={S.bTop}><div style={S.bNum}>{b.label}</div><div style={S.dBadge}>{b.driver}</div></div>
                  <div style={S.bRow}><span>Diesel</span><span style={S.bVal}>{fmt(b.diesel)}</span></div>
                  <div style={S.bRow}><span>Maintenance</span><span style={S.bVal}>{fmt(b.maint)}</span></div>
                  <div style={S.bRow}><span>Other</span><span style={S.bVal}>{fmt(b.other)}</span></div>
                  <div style={S.bRow}><span>Total KM</span><span style={{ color: "#60a5fa", fontWeight: 600 }}>{b.totalKm.toFixed(1)} km</span></div>
                  <div style={S.bRow}><span>Students</span><span style={{ color: "#a78bfa", fontWeight: 600 }}>{b.students}</span></div>
                  {(() => {
                    const pred = fuelPredictions.find(p => p.label === b.label);
                    return pred?.nextFuelDate ? <div style={S.bRow}><span>Next Fuel</span><span style={{ color: urgencyColor(pred.urgency), fontWeight: 600 }}>{fmtDate(pred.nextFuelDate)}</span></div> : null;
                  })()}
                  {b.avgMileage && <div style={S.bRow}><span>Avg Mileage</span><span style={{ color: "#34d399", fontWeight: 700 }}>{b.avgMileage} km/L</span></div>}
                  <div style={S.bTot}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Total Spent</span>
                    <span style={{ fontSize: 15, fontWeight: 900, color: "#f87171" }}>{fmt(b.diesel + b.maint + b.other)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DIESEL TAB */}
        {tab === "Diesel" && (
          <div style={S.card}>
            <div style={S.sec}>Add Diesel Entry</div>
            <div style={S.mb}><label style={S.lbl}>Bus and Driver</label><BusSelect value={dieselForm.bus} onChange={v => setDieselForm({ ...dieselForm, bus: v })} /></div>
            <div style={{ ...S.mb, background: "#071018", border: "1px solid #1e3a5f", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Fixed daily KM</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#60a5fa" }}>{currentBusDailyKm || "--"} km</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{dieselEstimate.label}</div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>{dieselEstimate.info}</div>
            </div>
            <div style={S.mb}><label style={S.lbl}>Date</label><input type="date" style={S.input} value={dieselForm.date} onChange={e => setDieselForm({ ...dieselForm, date: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Liters Filled</label><input type="number" placeholder="e.g. 40" style={S.input} value={dieselForm.liters} onChange={e => setDieselForm({ ...dieselForm, liters: e.target.value })} /></div>
            <div style={S.mb}>
              <label style={S.lbl}>Price per Liter (Rs.)</label>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                💡 <strong>Alternative:</strong> Just enter the diesel price manually below. The app will remember it for next time.
              </div>
              <button style={S.oBtn(fetchingPrice ? "#334155" : "#60a5fa")} onClick={fetchDieselPrice} disabled={fetchingPrice}>
                {fetchingPrice ? "Fetching Telangana price..." : "Get Today's Diesel Price - Telangana"}
              </button>
              {fetchedPrice && (
                <div style={{ background: "#0a1628", border: "1px solid #1d4ed8", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#4ade80" }}>Rs.{fetchedPrice.price}/L</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{fetchedPrice.date} - {fetchedPrice.source}</div>
                </div>
              )}
              <div style={{ position: "relative" }}>
                <input 
                  type="number" 
                  placeholder="Enter diesel price 90-103 only" 
                  style={{
                    ...S.input,
                    borderColor: priceError ? "#ef4444" : "#1e3a5f",
                    boxShadow: priceError ? "0 0 0 2px rgba(239, 68, 68, 0.1)" : "none"
                  }} 
                  value={dieselForm.pricePerLiter} 
                  onChange={e => handlePriceChange(e.target.value)}
                  onBlur={handlePriceBlur}
                />
                {dieselForm.pricePerLiter && (
                  <button 
                    onClick={() => { setDieselForm({ ...dieselForm, pricePerLiter: "" }); setPriceError(""); }} 
                    style={{ 
                      position: "absolute", 
                      right: 8, 
                      top: "50%", 
                      transform: "translateY(-50%)", 
                      background: "none", 
                      border: "none",
                      color: "#64748b", 
                      fontSize: 16, 
                      cursor: "pointer", 
                      padding: "4px" 
                    }}
                    title="Clear price"
                  >
                    ✕
                  </button>
                )}
              </div>
              {priceError && (
                <div style={{ 
                  fontSize: 12, 
                  color: "#ef4444", 
                  marginTop: 4, 
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4
                }}>
                  ⚠️ {priceError}
                </div>
              )}
            </div>
            {dieselForm.liters && dieselForm.pricePerLiter && (
              <div style={S.calc}>
                <span style={{ color: "#475569", fontSize: 12 }}>Total: </span>
                <span style={{ color: "#4ade80", fontWeight: 900, fontSize: 18 }}>Rs.{(parseFloat(dieselForm.liters) * parseFloat(dieselForm.pricePerLiter)).toFixed(2)}</span>
              </div>
            )}
            <div style={S.row2}>
              <div><label style={S.lbl}>KM Before</label><input type="number" placeholder="Meter reading" style={S.input} value={dieselForm.kmBefore} onChange={e => setDieselForm({ ...dieselForm, kmBefore: e.target.value })} /></div>
              <div><label style={S.lbl}>KM After</label><input type="number" placeholder="Meter reading" style={S.input} value={dieselForm.kmAfter} onChange={e => setDieselForm({ ...dieselForm, kmAfter: e.target.value })} /></div>
            </div>
            {dieselForm.kmBefore && dieselForm.kmAfter && dieselForm.liters && (
              <div style={{ ...S.calc, marginBottom: 10 }}>
                <span style={{ color: "#475569", fontSize: 12 }}>Mileage: </span>
                <span style={{ color: "#34d399", fontWeight: 900, fontSize: 18 }}>
                  {((parseFloat(dieselForm.kmAfter) - parseFloat(dieselForm.kmBefore)) / parseFloat(dieselForm.liters)).toFixed(2)} km/L
                </span>
              </div>
            )}
            <div style={S.mb}><label style={S.lbl}>Note</label><input type="text" placeholder="Any note..." style={S.input} value={dieselForm.note} onChange={e => setDieselForm({ ...dieselForm, note: e.target.value })} /></div>
            <div style={S.mb}>
              <label style={S.lbl}>💳 Payment Method (Compulsory)</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <button 
                  onClick={() => setDieselForm({ ...dieselForm, paymentMethod: "Cash" })}
                  style={{ 
                    padding: "14px 12px", 
                    borderRadius: 12, 
                    border: dieselForm.paymentMethod === "Cash" ? "2px solid #4ade80" : "1px solid rgba(100,116,139,0.2)",
                    background: dieselForm.paymentMethod === "Cash" ? "rgba(74,222,128,0.12)" : "rgba(100,116,139,0.08)",
                    color: dieselForm.paymentMethod === "Cash" ? "#4ade80" : "#cbd5e1",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  💵 Cash Paid
                </button>
                <button 
                  onClick={() => setDieselForm({ ...dieselForm, paymentMethod: "UPI" })}
                  style={{ 
                    padding: "14px 12px", 
                    borderRadius: 12, 
                    border: dieselForm.paymentMethod === "UPI" ? "2px solid #38bdf8" : "1px solid rgba(100,116,139,0.2)",
                    background: dieselForm.paymentMethod === "UPI" ? "rgba(56,189,248,0.12)" : "rgba(100,116,139,0.08)",
                    color: dieselForm.paymentMethod === "UPI" ? "#38bdf8" : "#cbd5e1",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  📱 UPI Paid
                </button>
                <button 
                  onClick={() => setDieselForm({ ...dieselForm, paymentMethod: "Khata" })}
                  style={{ 
                    padding: "14px 12px", 
                    borderRadius: 12, 
                    border: dieselForm.paymentMethod === "Khata" ? "2px solid #fbbf24" : "1px solid rgba(100,116,139,0.2)",
                    background: dieselForm.paymentMethod === "Khata" ? "rgba(251,191,36,0.12)" : "rgba(100,116,139,0.08)",
                    color: dieselForm.paymentMethod === "Khata" ? "#fbbf24" : "#cbd5e1",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  📖 Khata
                </button>
              </div>
              {!dieselForm.paymentMethod && (
                <div style={{ fontSize: 11, color: "#ef4444", marginTop: 8, fontWeight: 600 }}>⚠️ Payment method is required!</div>
              )}
            </div>
            <div style={S.mb}>
              <label style={S.lbl}>Fuel Bill Photo</label>
              <BillCapture value={dieselForm.billImage} onChange={img => setDieselForm({ ...dieselForm, billImage: img })} />
            </div>
            <button style={S.btn("#1e40af")} onClick={saveDiesel}>+ Save Diesel Entry</button>

            {dieselEntries.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={S.sec}>Recent Diesel Entries</div>
                {dieselEntries.slice(0, 8).map(e => (
                  <div key={e.id} style={{ ...S.hItem, flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                          <span style={S.badge("Diesel")}>DIESEL</span>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 9, fontWeight: 700, background: e.paymentMethod === "Cash" ? "rgba(74,222,128,0.2)" : e.paymentMethod === "UPI" ? "rgba(56,189,248,0.2)" : "rgba(251,191,36,0.2)", color: e.paymentMethod === "Cash" ? "#4ade80" : e.paymentMethod === "UPI" ? "#38bdf8" : "#fbbf24" }}>{e.paymentMethod === "Cash" ? "💵 CASH" : e.paymentMethod === "UPI" ? "📱 UPI" : "📖 KHATA"}</span>
                        </div>
                        <div style={S.hBus}>{e.bus}</div>
                        <div style={S.hDrv}>{e.driver}</div>
                        <div style={S.hDtl}>{e.liters}L x Rs.{e.pricePerLiter}{e.mileage ? " - " + e.mileage + " km/L" : ""}</div>
                        <div style={S.hDate}>{e.date}{e.note ? " - " + e.note : ""}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={S.hAmt}>{fmt(e.total)}</div>
                        {e.billImage && <div style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>Bill</div>}
                      </div>
                    </div>
                    {e.billImage && (
                      <img src={e.billImage} alt="bill" onClick={() => setViewBill(e.billImage)}
                        style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 8, marginTop: 8, border: "1px solid #1e3a5f", cursor: "pointer" }} />
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <ShareBtn entry={e} />
                      <DelBtn dtype="diesel" id={e.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "Maintenance" && (
          <div style={S.card}>
            <div style={S.sec}>Add Maintenance Entry</div>
            <div style={S.mb}><label style={S.lbl}>Bus and Driver</label><BusSelect value={maintForm.bus} onChange={v => setMaintForm({ ...maintForm, bus: v })} /></div>
            <div style={S.mb}><label style={S.lbl}>Date</label><input type="date" style={S.input} value={maintForm.date} onChange={e => setMaintForm({ ...maintForm, date: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Maintenance Type</label><input type="text" placeholder="e.g. Engine service" style={S.input} value={maintForm.type} onChange={e => setMaintForm({ ...maintForm, type: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Amount</label><input type="number" placeholder="Amount" style={S.input} value={maintForm.amount} onChange={e => setMaintForm({ ...maintForm, amount: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Note</label><input type="text" placeholder="Note" style={S.input} value={maintForm.note} onChange={e => setMaintForm({ ...maintForm, note: e.target.value })} /></div>
            <button style={S.btn("#7c2d12")} onClick={saveMaint}>+ Save Maintenance</button>

            {maintEntries.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={S.sec}>Recent Maintenance</div>
                {maintEntries.slice(0, 8).map(e => (
                  <div key={e.id} style={S.hItem}>
                    <div style={S.bTop}><div><span style={S.badge("Maint")}>MAINT</span><div style={S.hBus}>{e.bus}</div></div><div style={{ textAlign: "right" }}><div style={S.hAmt}>{fmt(e.amount)}</div></div></div>
                    <div style={S.hDtl}>{e.type} · {e.note}</div>
                    <div style={S.hDate}>{e.date}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}><DelBtn dtype="maint" id={e.id} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "Other" && (
          <div style={S.card}>
            <div style={S.sec}>Add Other Expense</div>
            <div style={S.mb}><label style={S.lbl}>Bus and Driver</label><BusSelect value={otherForm.bus} onChange={v => setOtherForm({ ...otherForm, bus: v })} /></div>
            <div style={S.mb}><label style={S.lbl}>Date</label><input type="date" style={S.input} value={otherForm.date} onChange={e => setOtherForm({ ...otherForm, date: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Expense Type</label><input type="text" placeholder="e.g. Toll, salary" style={S.input} value={otherForm.type} onChange={e => setOtherForm({ ...otherForm, type: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Amount</label><input type="number" placeholder="Amount" style={S.input} value={otherForm.amount} onChange={e => setOtherForm({ ...otherForm, amount: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Note</label><input type="text" placeholder="Note" style={S.input} value={otherForm.note} onChange={e => setOtherForm({ ...otherForm, note: e.target.value })} /></div>
            <button style={S.btn("#166534")} onClick={saveOther}>+ Save Other Expense</button>

            {otherEntries.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={S.sec}>Recent Other Expenses</div>
                {otherEntries.slice(0, 8).map(e => (
                  <div key={e.id} style={S.hItem}>
                    <div style={S.bTop}><div><span style={S.badge("Other")}>OTHER</span><div style={S.hBus}>{e.bus}</div></div><div style={{ textAlign: "right" }}><div style={S.hAmt}>{fmt(e.amount)}</div></div></div>
                    <div style={S.hDtl}>{e.type} · {e.note}</div>
                    <div style={S.hDate}>{e.date}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}><DelBtn dtype="other" id={e.id} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "Routes" && (
          <div style={S.card}>
            <div style={S.sec}>Add Route Record</div>
            <div style={S.mb}><label style={S.lbl}>Bus and Driver</label><BusSelect value={routeForm.bus} onChange={v => setRouteForm({ ...routeForm, bus: v })} /></div>
            <div style={S.mb}><label style={S.lbl}>Date</label><input type="date" style={S.input} value={routeForm.date} onChange={e => setRouteForm({ ...routeForm, date: e.target.value })} /></div>
            <div style={S.mb}><label style={S.lbl}>Route Name</label><input type="text" placeholder="Route description" style={S.input} value={routeForm.route} onChange={e => setRouteForm({ ...routeForm, route: e.target.value })} /></div>
            <div style={S.row2}>
              <div><label style={S.lbl}>KM Start</label><input type="number" placeholder="Start" style={S.input} value={routeForm.kmStart} onChange={e => setRouteForm({ ...routeForm, kmStart: e.target.value })} /></div>
              <div><label style={S.lbl}>KM End</label><input type="number" placeholder="End" style={S.input} value={routeForm.kmEnd} onChange={e => setRouteForm({ ...routeForm, kmEnd: e.target.value })} /></div>
            </div>
            <div style={S.mb}><label style={S.lbl}>Note</label><input type="text" placeholder="Note" style={S.input} value={routeForm.note} onChange={e => setRouteForm({ ...routeForm, note: e.target.value })} /></div>
            <button style={S.btn("#0f766e")} onClick={saveRoute}>+ Save Route</button>

            {routeEntries.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={S.sec}>Recent Routes</div>
                {routeEntries.slice(0, 8).map(e => (
                  <div key={e.id} style={S.hItem}>
                    <div style={S.bTop}><div><span style={S.badge("Route")}>ROUTE</span><div style={S.hBus}>{e.bus}</div></div><div style={{ textAlign: "right" }}><div style={S.hAmt}>{e.km.toFixed(1)} km</div></div></div>
                    <div style={S.hDtl}>{e.route} · {e.note}</div>
                    <div style={S.hDate}>{e.date}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}><DelBtn dtype="route" id={e.id} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "Students" && (
          <div style={S.card}>
            <div style={S.sec}>{editStuId ? "Edit Student Route" : "Add Student Route"}</div>
            <div style={S.mb}><label style={S.lbl}>Bus and Driver</label><BusSelect value={stuForm.bus} onChange={v => setStuForm({ ...stuForm, bus: v })} /></div>
            <div style={S.mb}><label style={S.lbl}>Route Name</label><input type="text" placeholder="Route" style={S.input} value={stuForm.route} onChange={e => setStuForm({ ...stuForm, route: e.target.value })} /></div>
            <div style={S.row2}>
              <div><label style={S.lbl}>Student Count</label><input type="number" placeholder="Count" style={S.input} value={stuForm.count} onChange={e => setStuForm({ ...stuForm, count: e.target.value })} /></div>
              <div><label style={S.lbl}>Villages</label><input type="text" placeholder="Villages" style={S.input} value={stuForm.villages} onChange={e => setStuForm({ ...stuForm, villages: e.target.value })} /></div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={S.btn("#4c1d95")} onClick={saveStudentRoute}>{editStuId ? "Update" : "+ Save Student"}</button>
              {editStuId && <button style={S.oBtn("#ef4444")} onClick={() => { setEditStuId(null); setStuForm({ bus: BUSES[0].label, route: "", count: "", villages: "" }); }}>Cancel</button>}
            </div>

            {studentRoutes.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={S.sec}>Student Routes</div>
                {studentRoutes.map(e => (
                  <div key={e.id} style={S.hItem}>
                    <div style={S.bTop}><div><span style={S.badge("Stu")}>STU</span><div style={S.hBus}>{e.bus}</div></div><div style={{ textAlign: "right" }}><div style={S.hAmt}>{e.count} students</div></div></div>
                    <div style={S.hDtl}>{e.route} · {e.villages}</div>
                    <div style={S.hDate}>{e.driver}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                      <button onClick={() => { setEditStuId(e.id); setStuForm({ bus: e.bus, route: e.route, count: String(e.count), villages: e.villages }); }} style={S.oBtn("#2563eb")}>Edit</button>
                      <DelBtn dtype="student" id={e.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "Fuel Plan" && (
          <div style={S.card}>
            <div style={S.sec}>Fuel Plan Settings</div>
            <div style={S.mb}><label style={S.lbl}>Select Bus</label><BusSelect value={chartBus} onChange={v => setChartBus(v)} /></div>
            <div style={S.row2}>
              <div><label style={S.lbl}>Daily KM</label><input type="number" placeholder="Daily KM" style={S.input} value={busSettings[chartBus]?.dailyKm || ""} onChange={e => setBusSettings({ ...busSettings, [chartBus]: { ...busSettings[chartBus], dailyKm: e.target.value } })} /></div>
              <div><label style={S.lbl}>Tank Liters</label><input type="number" placeholder="Tank capacity" style={S.input} value={busSettings[chartBus]?.tankLiters || ""} onChange={e => setBusSettings({ ...busSettings, [chartBus]: { ...busSettings[chartBus], tankLiters: e.target.value } })} /></div>
            </div>
            <button style={S.btn("#f59e0b")} onClick={saveBusSettings}>Save Bus Settings</button>

            <div style={{ marginTop: 20, padding: 16, background: "#0b1120", borderRadius: 12, border: "1px solid #1e3a5f" }}>
              <div style={S.sec}>Holiday Calendar</div>
              <div style={S.row2}>
                <div><label style={S.lbl}>Holiday Date</label><input type="date" style={S.input} value={newHoliday.date} onChange={e => setNewHoliday({ ...newHoliday, date: e.target.value })} /></div>
                <div><label style={S.lbl}>Holiday Name</label><input type="text" style={S.input} value={newHoliday.name} onChange={e => setNewHoliday({ ...newHoliday, name: e.target.value })} placeholder="Holiday name" /></div>
              </div>
              <button style={S.btn("#8b5cf6")} onClick={addHoliday}>+ Add Holiday</button>
              {holidays.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  {holidays.map(h => (
                    <div key={h.date} style={{ ...S.hItem, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div><div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{fmtDate(h.date)}</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{h.name}</div></div>
                      <HolDelBtn hdate={h.date} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "Reports" && (
          <div style={S.card}>
            <div style={{fontSize: 16, fontWeight: 900, color: "#e2e8f0", marginBottom: 16}}>
              📊 Reports & Account Summary
            </div>
            
            {selectedAccount === null ? (
              <>
                {/* Account Cards - Clickable */}
                <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16}}>
                  {/* Cash Account */}
                  <div onClick={() => setSelectedAccount("Cash")} style={{background: "linear-gradient(135deg, #166534 0%, #15803d 100%)", padding: 12, borderRadius: 8, border: "2px solid #22c55e", cursor: "pointer", transition: "transform 0.2s", transform: "scale(1)"}}>
                    <div style={{color: "#dcfce7", fontSize: 12, fontWeight: 600}}>💵 CASH PAID</div>
                    <div style={{fontSize: 20, fontWeight: 900, color: "#dcfce7", marginTop: 8}}>
                      Rs. {fmt(dieselEntries.filter(e => e.paymentMethod === "Cash").reduce((sum, e) => sum + (e.total || 0), 0))}
                    </div>
                    <div style={{color: "#86efac", fontSize: 11, marginTop: 4}}>✓ Settled • Click to view history</div>
                  </div>
                  
                  {/* UPI Account */}
                  <div onClick={() => setSelectedAccount("UPI")} style={{background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)", padding: 12, borderRadius: 8, border: "2px solid #0ea5e9", cursor: "pointer", transition: "transform 0.2s"}}>
                    <div style={{color: "#bfdbfe", fontSize: 12, fontWeight: 600}}>📱 UPI PAID</div>
                    <div style={{fontSize: 20, fontWeight: 900, color: "#bfdbfe", marginTop: 8}}>
                      Rs. {fmt(dieselEntries.filter(e => e.paymentMethod === "UPI").reduce((sum, e) => sum + (e.total || 0), 0))}
                    </div>
                    <div style={{color: "#93c5fd", fontSize: 11, marginTop: 4}}>✓ Settled • Click to view history</div>
                  </div>
                  
                  {/* Khata Account */}
                  <div onClick={() => setSelectedAccount("Khata")} style={{background: khataInfo.isPaid ? "linear-gradient(135deg, #166534 0%, #15803d 100%)" : "linear-gradient(135deg, #713f12 0%, #78350f 100%)", padding: 12, borderRadius: 8, border: khataInfo.isPaid ? "2px solid #22c55e" : "2px solid #fbbf24", cursor: "pointer", transition: "transform 0.2s"}}>
                    <div style={{color: khataInfo.isPaid ? "#dcfce7" : "#fef3c7", fontSize: 12, fontWeight: 600}}>📖 KHATA</div>
                    <div style={{fontSize: 20, fontWeight: 900, color: khataInfo.isPaid ? "#dcfce7" : "#fef3c7", marginTop: 8}}>
                      Rs. {fmt(dieselEntries.filter(e => e.paymentMethod === "Khata").reduce((sum, e) => sum + (e.total || 0), 0))}
                    </div>
                    <div style={{color: khataInfo.isPaid ? "#86efac" : "#fcd34d", fontSize: 11, marginTop: 4}}>
                      {khataInfo.isPaid ? "✓ Settled" : "⚠️ Outstanding"} • Click to view
                    </div>
                  </div>
                </div>

                {/* CSV Export Button */}
                <button style={{...S.btn("#9333ea"), width: "100%", marginBottom: 16, fontSize: 14}} onClick={exportCSV}>
                  📊 Download CSV Report (All Data with Accounts)
                </button>
                
                {/* Summary */}
                <div style={{background: "#1a2a3a", padding: 12, borderRadius: 8, border: "1px solid #334155"}}>
                  <div style={{fontSize: 14, fontWeight: 800, color: "#e2e8f0", marginBottom: 10}}>💰 Financial Summary</div>
                  <div style={{fontSize: 12, color: "#cbd5e1", lineHeight: 1.8}}>
                    <div style={{display: "flex", justifyContent: "space-between", marginBottom: 8}}>
                      <span>Diesel Total:</span>
                      <span style={{fontWeight: 700}}>Rs. {fmt(totalDiesel)}</span>
                    </div>
                    <div style={{display: "flex", justifyContent: "space-between", marginBottom: 8}}>
                      <span>Maintenance Total:</span>
                      <span style={{fontWeight: 700}}>Rs. {fmt(totalMaint)}</span>
                    </div>
                    <div style={{display: "flex", justifyContent: "space-between", marginBottom: 12}}>
                      <span>Other Expenses:</span>
                      <span style={{fontWeight: 700}}>Rs. {fmt(totalOther)}</span>
                    </div>
                    <div style={{borderTop: "1px solid #475569", paddingTop: 12, display: "flex", justifyContent: "space-between"}}>
                      <span style={{fontWeight: 800}}>Grand Total:</span>
                      <span style={{fontWeight: 900, color: "#f472b6", fontSize: 14}}>Rs. {fmt(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* History View */}
                <button onClick={() => setSelectedAccount(null)} style={{...S.btn("#666"), width: "100%", marginBottom: 12, fontSize: 12}}>
                  ← Back to Summary
                </button>

                <div style={{background: "#1a2a3a", padding: 12, borderRadius: 8, border: "1px solid #334155", marginBottom: 16}}>
                  <div style={{fontSize: 14, fontWeight: 800, color: "#e2e8f0", marginBottom: 12}}>
                    {selectedAccount === "Cash" && "💵 CASH Payment History"}
                    {selectedAccount === "UPI" && "📱 UPI Payment History"}
                    {selectedAccount === "Khata" && (
                      <div style={{display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 10}}>
                        <span>📖 KHATA Outstanding</span>
                        {adminPin && (
                          <button onClick={() => setShowKhataPaidHistory(!showKhataPaidHistory)} style={{...S.btn("#1e40af"), fontSize: 9, padding: "3px 6px", whiteSpace: "nowrap"}}>
                            {showKhataPaidHistory ? "◀ Outstanding" : "▶ Paid (Admin)"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {selectedAccount === "Khata" && showKhataPaidHistory ? (
                    <>
                      {/* Admin View: Paid Khata Entries */}
                      {dieselEntries.filter(e => e.paymentMethod === "Khata" && paidKhataEntries.includes(e.id)).length === 0 ? (
                        <div style={{color: "#94a3b8", fontSize: 12, textAlign: "center", padding: 16}}>
                          No marked as paid entries yet
                        </div>
                      ) : (
                        <div style={{maxHeight: "400px", overflowY: "auto"}}>
                          {dieselEntries.filter(e => e.paymentMethod === "Khata" && paidKhataEntries.includes(e.id)).map((entry, idx) => (
                            <div key={idx} style={{background: "#1a3a1a", padding: 10, borderRadius: 6, marginBottom: 8, border: "1px solid #22c55e", display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                              <div style={{flex: 1, fontSize: 12}}>
                                <div style={{color: "#dcfce7", fontWeight: 600}}>
                                  ✅ {entry.bus} • {entry.date}
                                </div>
                                <div style={{color: "#86efac", fontSize: 11, marginTop: 4}}>
                                  {entry.liters}L @ Rs.{entry.pricePerLiter}/L = <strong>Rs. {entry.total}</strong>
                                </div>
                                {entry.note && <div style={{color: "#64748b", fontSize: 10, marginTop: 2}}>Note: {entry.note}</div>}
                              </div>
                              
                              <button 
                                onClick={() => {
                                  const newPaid = paidKhataEntries.filter(id => id !== entry.id);
                                  setPaidKhataEntries(newPaid);
                                  localStorage.setItem("paidKhataEntries", JSON.stringify(newPaid));
                                  showToast("Marked as unpaid (Admin)");
                                }}
                                style={{...S.btn("#dc2626"), marginLeft: 10, fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap"}}
                              >
                                🔓 Unmark
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Regular View: Outstanding Khata Entries */}
                      {dieselEntries.filter(e => e.paymentMethod === selectedAccount && !paidKhataEntries.includes(e.id)).length === 0 ? (
                        <div style={{color: "#94a3b8", fontSize: 12, textAlign: "center", padding: 16}}>
                          {selectedAccount === "Khata" ? "No outstanding Khata transactions" : `No ${selectedAccount} transactions found`}
                        </div>
                      ) : (
                        <div style={{maxHeight: "400px", overflowY: "auto"}}>
                          {dieselEntries.filter(e => e.paymentMethod === selectedAccount && (selectedAccount !== "Khata" || !paidKhataEntries.includes(e.id))).map((entry, idx) => (
                            <div key={idx} style={{background: "#0d1525", padding: 10, borderRadius: 6, marginBottom: 8, border: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                              <div style={{flex: 1, fontSize: 12}}>
                                <div style={{color: "#e2e8f0", fontWeight: 600}}>
                                  {entry.bus} • {entry.date}
                                </div>
                                <div style={{color: "#94a3b8", fontSize: 11, marginTop: 4}}>
                                  {entry.liters}L @ Rs.{entry.pricePerLiter}/L = <strong>Rs. {entry.total}</strong>
                                </div>
                                {entry.note && <div style={{color: "#64748b", fontSize: 10, marginTop: 2}}>Note: {entry.note}</div>}
                              </div>
                              
                              {selectedAccount === "Khata" && (
                                <button 
                                  onClick={() => {
                                    const newPaid = [...paidKhataEntries, entry.id];
                                    setPaidKhataEntries(newPaid);
                                    localStorage.setItem("paidKhataEntries", JSON.stringify(newPaid));
                                    showToast("Marked as paid ✅");
                                  }}
                                  style={{...S.btn("#22c55e"), marginLeft: 10, fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap"}}
                                >
                                  ✅ Paid
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Summary for selected account */}
                <div style={{background: "#1a2a3a", padding: 12, borderRadius: 8, border: "1px solid #334155"}}>
                  <div style={{fontSize: 12, color: "#cbd5e1", lineHeight: 1.8}}>
                    <div style={{display: "flex", justifyContent: "space-between"}}>
                      <span>{selectedAccount} Total:</span>
                      <span style={{fontWeight: 700, fontSize: 14, color: selectedAccount === "Khata" ? "#fcd34d" : selectedAccount === "UPI" ? "#93c5fd" : "#86efac"}}>
                        Rs. {fmt(dieselEntries.filter(e => e.paymentMethod === selectedAccount).reduce((sum, e) => sum + (e.total || 0), 0))}
                      </span>
                    </div>
                    {selectedAccount === "Khata" && (
                      <>
                        <div style={{display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid #475569"}}>
                          <span>Paid Entries:</span>
                          <span style={{fontWeight: 700}}>Rs. {fmt(dieselEntries.filter(e => e.paymentMethod === "Khata" && paidKhataEntries.includes(e.id)).reduce((sum, e) => sum + (e.total || 0), 0))}</span>
                        </div>
                        <div style={{display: "flex", justifyContent: "space-between", marginTop: 6}}>
                          <span>Still Outstanding:</span>
                          <span style={{fontWeight: 700, color: "#f472b6"}}>Rs. {fmt(dieselEntries.filter(e => e.paymentMethod === "Khata" && !paidKhataEntries.includes(e.id)).reduce((sum, e) => sum + (e.total || 0), 0))}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {userRole === 'admin' && tab === "Settings" && (
          <div style={S.card}>
            <div style={{fontSize: 16, fontWeight: 900, color: "#e2e8f0", marginBottom: 16}}>
              ⚙️ Settings & Data Management
            </div>

            <div style={{background: "#1a2a3a", padding: 16, borderRadius: 8, border: "1px solid #334155", marginBottom: 16}}>
              <div style={{fontSize: 14, fontWeight: 800, color: "#e2e8f0", marginBottom: 12}}>🔐 Manage Login PINs</div>
              
              <div style={{marginBottom: 16}}>
                <label style={{color: "#cbd5e1", fontSize: 12, fontWeight: 600}}>Admin PIN (Current: <span style={{color: '#4ade80'}}>{adminPin}</span>)</label>
                <div style={{display: 'flex', gap: 8, marginTop: 8}}>
                  <input
                    type="text"
                    placeholder="Enter new Admin PIN"
                    value={newAdminPin}
                    onChange={e => setNewAdminPin(e.target.value.slice(0, 4))}
                    style={{flex: 1, padding: 8, borderRadius: 4, border: "1px solid #475569", background: "#0d1525", color: "#e2e8f0"}}
                  />
                  <button
                    onClick={() => {
                      if (newAdminPin && newAdminPin.length === 4) {
                        setAdminPin(newAdminPin);
                        setNewAdminPin('');
                        showToast('✅ Admin PIN updated!');
                      } else {
                        showToast('⚠️ PIN must be 4 digits');
                      }
                    }}
                    style={{...S.btn("#4ade80"), padding: "8px 16px"}}
                  >
                    Update
                  </button>
                </div>
              </div>

              <div style={{marginBottom: 16}}>
                <label style={{color: "#cbd5e1", fontSize: 12, fontWeight: 600}}>Accountant PIN (Current: <span style={{color: '#fbbf24'}}>{accountantPin}</span>)</label>
                <div style={{display: 'flex', gap: 8, marginTop: 8}}>
                  <input
                    type="text"
                    placeholder="Enter new Accountant PIN"
                    value={newAccountantPin}
                    onChange={e => setNewAccountantPin(e.target.value.slice(0, 4))}
                    style={{flex: 1, padding: 8, borderRadius: 4, border: "1px solid #475569", background: "#0d1525", color: "#e2e8f0"}}
                  />
                  <button
                    onClick={() => {
                      if (newAccountantPin && newAccountantPin.length === 4) {
                        setAccountantPin(newAccountantPin);
                        setNewAccountantPin('');
                        showToast('✅ Accountant PIN updated!');
                      } else {
                        showToast('⚠️ PIN must be 4 digits');
                      }
                    }}
                    style={{...S.btn("#fbbf24"), padding: "8px 16px", color: '#000'}}
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>

            <div style={{background: "#1a2a3a", padding: 16, borderRadius: 8, border: "1px solid #334155", marginBottom: 16}}>
              <div style={{fontSize: 14, fontWeight: 800, color: "#e2e8f0", marginBottom: 12}}>Manage Buses & Drivers</div>
              {buses.map((bus, i) => (
                <div key={i} style={{display: "flex", gap: 8, marginBottom: 8, alignItems: "center"}}>
                  <input
                    type="text"
                    placeholder="Bus Number"
                    value={bus.label}
                    onChange={e => {
                      const newBuses = [...buses];
                      newBuses[i].label = e.target.value;
                      setBuses(newBuses);
                    }}
                    style={{flex: 1, padding: 8, borderRadius: 4, border: "1px solid #475569", background: "#0d1525", color: "#e2e8f0"}}
                  />
                  <input
                    type="text"
                    placeholder="Driver Name"
                    value={bus.driver}
                    onChange={e => {
                      const newBuses = [...buses];
                      newBuses[i].driver = e.target.value;
                      setBuses(newBuses);
                    }}
                    style={{flex: 1, padding: 8, borderRadius: 4, border: "1px solid #475569", background: "#0d1525", color: "#e2e8f0"}}
                  />
                  <button
                    onClick={() => {
                      const newBuses = buses.filter((_, j) => j !== i);
                      setBuses(newBuses);
                    }}
                    style={{...S.btn("#dc2626"), padding: "8px 12px"}}
                  >
                    Delete
                  </button>
                </div>
              ))}
              <button
                onClick={() => setBuses([...buses, {label: '', driver: ''}])}
                style={{...S.btn("#22c55e"), width: "100%", marginTop: 8}}
              >
                + Add Bus
              </button>
              <button
                onClick={async () => {
                  await storageService.save(StorageKeys.BUSES, buses);
                  showToast("Buses saved successfully!");
                }}
                style={{...S.btn("#2563eb"), width: "100%", marginTop: 8}}
              >
                Save Changes
              </button>
            </div>

            <div style={{background: "#1a2a3a", padding: 16, borderRadius: 8, border: "1px solid #334155"}}>
              <div style={{fontSize: 14, fontWeight: 800, color: "#e2e8f0", marginBottom: 12}}>Default Daily KM per Bus</div>
              {Object.keys(defaultKm).map(bus => (
                <div key={bus} style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8}}>
                  <label style={{color: "#cbd5e1", fontSize: 12}}>{bus}:</label>
                  <input
                    type="number"
                    value={defaultKm[bus]}
                    onChange={e => setDefaultKm({...defaultKm, [bus]: parseFloat(e.target.value) || 0})}
                    style={{width: 80, padding: 6, borderRadius: 4, border: "1px solid #475569", background: "#0d1525", color: "#e2e8f0", textAlign: "center"}}
                  />
                </div>
              ))}
              <button
                onClick={async () => {
                  await storageService.save(StorageKeys.DEFAULT_KM, defaultKm);
                  showToast("Default KM saved successfully!");
                }}
                style={{...S.btn("#2563eb"), width: "100%", marginTop: 8}}
              >
                Save Default KM
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
