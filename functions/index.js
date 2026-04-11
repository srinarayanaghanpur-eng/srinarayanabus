const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// WhatsApp notification for absent teachers
exports.sendWhatsAppNotification = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { teacherId, teacherName, status, date, time } = data;

  // Only send for absent status
  if (status !== 'absent') {
    return { success: true, message: 'No notification needed for non-absent status' };
  }

  try {
    // Here you would integrate with WhatsApp Business API or a service like Twilio
    // For now, we'll log the notification and simulate sending

    const message = `Sri Narayana High School: ${teacherName} is marked ABSENT today (${date}). Time: ${time}`;

    // Log to Firebase
    await admin.firestore().collection('notifications').add({
      teacherId,
      teacherName,
      status,
      date,
      time,
      message,
      type: 'whatsapp',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sent: false // Set to true when actually sent via WhatsApp API
    });

    console.log('WhatsApp notification logged:', message);

    // TODO: Integrate with WhatsApp Business API
    // Example with Twilio:
    // const twilio = require('twilio');
    // const client = twilio(accountSid, authToken);
    // await client.messages.create({
    //   body: message,
    //   from: 'whatsapp:+1234567890',
    //   to: `whatsapp:${teacherPhoneNumber}`
    // });

    return { success: true, message: 'Notification logged successfully' };

  } catch (error) {
    console.error('WhatsApp notification error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send notification');
  }
});