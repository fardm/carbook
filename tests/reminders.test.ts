import { describe, expect, it } from "vitest";
import { checkAllReminders } from "../src/domain/reminders/checker";
import { todayIso } from "../src/domain/calendar/dates";
import { defaultDataset } from "../src/domain/defaults";

describe("reminders checker", () => {
  it("should trigger date reminders correctly", () => {
    const ds = defaultDataset();
    const today = todayIso();

    ds.reminders.push({
      id: "r1",
      vehicleId: "v1",
      serviceId: null,
      title: "Test Reminder",
      description: "",
      type: "date",
      dueDate: today,
      dueMileage: null,
      notificationOffsets: [{ daysBefore: 0, kmBefore: null }],
      repeat: "none",
      repeatKm: null,
      active: true,
      lastNotifiedAt: null,
      createdAt: "",
      updatedAt: ""
    });

    const res = checkAllReminders(ds);
    expect(res.notifications).toHaveLength(1);
    expect(res.notifications[0].title).toBe("Test Reminder");
    expect(res.mutatedDataset).not.toBeNull();
    if (res.mutatedDataset) {
        expect(res.mutatedDataset.reminders[0].lastNotifiedAt).not.toBeNull();
        expect(res.mutatedDataset.reminders[0].active).toBe(false); // Because repeat is none and it's due
    }
  });
});
