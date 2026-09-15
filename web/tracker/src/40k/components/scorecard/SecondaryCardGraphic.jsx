import React from "react";
import { getSecondaryMission } from "../../data/secondaryMissions.js";
import { SwordsCrossedIcon, ShieldGuardIcon } from "../common/Icons.jsx";

export function SecondaryCardGraphic({ slug, role = "attacker", mode = "tactical" }) {
  const mission = getSecondaryMission(slug);
  const isAttacker = role === "attacker";
  const badgeColor = isAttacker ? "#4d1818" : "#12472e";

  if (!mission) {
    return (
      <div className="card cB">
        <div className={`cB__header is-role-${role}`}>
          <div className="cB__headerLeft">
            <p className="cB__kind">SECONDARY</p>
            <h2 className="cB__name" style={{ fontSize: 46 }}>{slug}</h2>
          </div>
        </div>
      </div>
    );
  }

  const kindLabel = mission.kindLabel || "SECONDARY · TACTICAL";
  const displayKind =
    /FIXED/i.test(kindLabel) && /TACTICAL/i.test(kindLabel)
      ? mode === "fixed" ? "SECONDARY · FIXED" : "SECONDARY · TACTICAL"
      : kindLabel;

  const nameSize = mission.nameSize || 46;
  const applicableSections = mission.sections.filter(sec => {
    const isFixed = sec.chip === "FIXED" || sec.headerKind === "fixed";
    const isTactical = sec.chip === "TACTICAL";
    return mode === "tactical" ? !isFixed : !isTactical;
  });

  return (
    <div className="card cB" style={{ width: 580, height: 994 }}>
      {/* Card Header */}
      <div className={`cB__header is-role-${role}`}>
        <div className="cB__headerLeft">
          <p className="cB__kind">{displayKind}</p>
          <h2 className="cB__name" style={{ fontSize: nameSize }}>
            {mission.name}
          </h2>
        </div>

        {/* Archetype Shield */}
        <div className="cB__archetype">
          <div
            style={{
              width: 64,
              height: 74,
              background: badgeColor,
              clipPath: "polygon(0 0, 100% 0, 100% 75%, 50% 100%, 0 75%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 10
            }}
          >
            {isAttacker ? <SwordsCrossedIcon /> : <ShieldGuardIcon />}
          </div>
        </div>

        {mode === "fixed" && <div className="cB__fixedStripe" aria-hidden="true" />}
      </div>

      {/* Card Body */}
      <div className="cB__body" style={{ gap: 12 }}>
        {mission.whenDrawn && (
          <p
            className="cB__flavor is-secondary"
            dangerouslySetInnerHTML={{ __html: mission.whenDrawn }}
          />
        )}

        {/* Action Table (e.g. Cleanse, Plunder) */}
        {mission.action && (
          <div className="cB__section cB__action">
            <div className="cB__sectionHeader is-action">
              <span>{mission.action.title}</span>
              <span className="cB__chip">{mission.action.chip || "OBJECTIVE ACTION"}</span>
            </div>
            <div className="cB__sectionBody">
              {mission.action.rows.map((row, idx) => (
                <dl key={idx}>
                  <dt>
                    <i className="cB__dot" />
                    {row.k}
                  </dt>
                  <dd>
                    <span dangerouslySetInnerHTML={{ __html: row.v }} />
                  </dd>
                </dl>
              ))}
            </div>
          </div>
        )}

        {/* Sections */}
        {applicableSections.map((sec, secIdx) => (
          <div key={secIdx} className="cB__section">
            <div className={`cB__sectionHeader ${sec.headerKind ? `is-${sec.headerKind}` : ""}`}>
              <span>{sec.when}</span>
              <span className="cB__chip">{sec.chip || "TACTICAL"}</span>
            </div>

            <div className="cB__sectionBody">
              {sec.trigger && (
                <p className="cB__when">
                  <b>
                    <i className="cB__dot" />
                    WHEN
                  </b>
                  <span dangerouslySetInnerHTML={{ __html: sec.trigger }} />
                </p>
              )}

              {sec.rows.map((row, rowIdx) => (
                <div key={rowIdx} className={`cB__ruleRow ${row.or ? "is-or" : ""}`}>
                  {row.or && <div className="cB__orDivider"><span>OR</span></div>}
                  <div className="cB__ruleText" dangerouslySetInnerHTML={{ __html: row.text }} />
                  <div className="cB__vpBadge">
                    <span>{row.vp}</span>
                    <small>VP</small>
                  </div>
                </div>
              ))}

              {sec.cap && (
                <div className="cB__sectionCap" style={{ margin: 0 }}>
                  <span
                    className={`cB__capBadge ${sec.headerKind ? `is-${sec.headerKind}` : ""}`}
                    style={{ width: 78, textAlign: "center", padding: "5px 4px" }}
                  >
                    {sec.cap}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {mission.designerNote && (
          <div
            className="cB__note is-plain"
            dangerouslySetInnerHTML={{ __html: mission.designerNote }}
          />
        )}
      </div>
    </div>
  );
}
