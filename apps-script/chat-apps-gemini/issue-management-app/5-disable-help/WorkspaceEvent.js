/**
 * Copyright 2024 Google LLC
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     https://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// This script contains the Google Workspace events-specific utilities functions.

/**
 * Creates a new subscription to Google Workspace Events associated to a Google Chat space.
 * 
 * The subscription scope includes message creation events and resources.
 * 
 * @param {string} spaceId the space ID to create a subscription for
 * @returns the ID of the newly created subscription
 */
function createSpaceSubscription(spaceId) {
  const operation = WorkspaceEvents.Subscriptions.create({
    targetResource: `//chat.googleapis.com/${spaceId}`,
    eventTypes: ["google.workspace.chat.message.v1.created"],
    notificationEndpoint: { pubsubTopic: GWS_PUBSUB_TOPIC_ID },
    payloadOptions: { includeResource: true },
  });

  return JSON.parse(operation).response.name;
}

/**
 * Processes events from subscription by using the Google Cloud PubSub API.
 * 
 * It pulls and acknowledges each event.
 */
function processSubscription() {
  const response = UrlFetchApp.fetch(
    `https://pubsub.googleapis.com/v1/${GWS_PUBSUB_SUBSCRIPTION_ID}:pull`,
    {
      method: "POST",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ maxMessages: 10 })
    }
  );

  const messages = JSON.parse(response.getContentText()).receivedMessages;
  for (var messageIndex in messages) {
    const message = messages[messageIndex];
    const ceType = message.message.attributes["ce-type"];
    const dataStr =
      Utilities.newBlob(Utilities.base64Decode(message.message.data)).getDataAsString();
    if (ceType === "google.workspace.events.subscription.v1.expirationReminder") {
      // Renews subscription.
      renewSubscription(JSON.parse(dataStr).subscription.name);
    } else if (ceType === "google.workspace.chat.message.v1.created") {
      // Processes the message text when it's sent in a space with the inclusivity feature enabled.
      const chatMessage = JSON.parse(dataStr).message;
      if (
        chatMessage.sender.type !== "BOT"
        && shouldHelpWithInclusivity(chatMessage.space.name)
      ) {
        const inclusivityCheck = getInclusivityFeedback(chatMessage.text);
        if (inclusivityCheck !== "It's inclusive!") {
          createAppMessageUsingChatService({
            cardsV2: [{ cardId: "1", card: { header: {
                title: "Inclusivity",
                subtitle: `The following words are not inclusive: ${inclusivityCheck}`
            }}}],
            accessoryWidgets: [{ buttonList: { buttons: [{
              altText: "Disable inclusivity help",
              icon: {
                iconUrl: "https://upload.wikimedia.org/wikipedia/commons/6/63/Stop_hand_rugen.png"
              },
              onClick: { action: {
                function: "disableInclusivityHelp",
                parameters: [{
                  key: "spaceId",
                  value: chatMessage.space.name
                }]
              }}
            }]}}]
          },
          chatMessage.space.name);
        }
      }
    }
    // Acknowledges successful processing to avoid getting it again next time.
    ackSubscription(message.ackId);
  }
}

/**
 * Acknowledges a subscription event by using the Google Cloud PubSub API.
 * 
 * @param {string} ackId the ID of the event acknowledgment to send
 * @returns 
 */
function ackSubscription(ackId) {
  UrlFetchApp.fetch(
    `https://pubsub.googleapis.com/v1/${GWS_PUBSUB_SUBSCRIPTION_ID}:acknowledge`,
    {
      method: "POST",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({
        ackIds: [ackId]
      })
    }
  );
}

/**
 * Renews a subscription to Google Workspace Events.
 * 
 * The default time to live option is used.
 * 
 * @param {string} subscriptionId the ID of the subscription to renew
 */
function renewSubscription(subscriptionId) {
  WorkspaceEvents.Subscriptions.patch({ttl: '0s'}, subscriptionId);
}

/**
 * Deletes a subscription to Google Workspace Events.
 * 
 * @param {string} subscriptionId the ID of the subscription to delete
 */
function deleteSubscription(subscriptionId) {
  WorkspaceEvents.Subscriptions.remove(subscriptionId);
}
