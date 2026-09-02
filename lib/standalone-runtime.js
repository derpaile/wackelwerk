(function () {
  "use strict";

  window.WackelwerkStandalone = function (canvas, game) {
    var M = window.Matter;
    var ctx = canvas.getContext("2d");
    var engine = M.Engine.create({
      gravity: {
        x: game.physics.gravityX,
        y: game.physics.gravityY,
        scale: 0.001,
      },
      constraintIterations: 4,
      positionIterations: 8,
      velocityIterations: 6,
    });
    var ragdoll = [];
    var shapes = new Map();
    var entities = new Map();
    var collected = new Set();
    var reached = new Set();
    var hits = new Map();
    var drag = null;
    var pointer = null;
    var running = true;
    var muted = false;
    var phase = "running";
    var score = 0;
    var elapsed = 0;
    var accumulator = 0;
    var last = performance.now();
    var step = 1000 / 60;
    var audio = null;
    var reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var pieces = [];

    var scoreNode = document.getElementById("score");
    var timeNode = document.getElementById("time");
    var pauseButton = document.getElementById("pause");
    var resetButton = document.getElementById("reset");
    var muteButton = document.getElementById("mute");
    var message = document.getElementById("message");
    var messageTitle = document.getElementById("message-title");
    var messageCopy = document.getElementById("message-copy");

    function tone(frequency, duration) {
      if (muted || !audio) return;
      var oscillator = audio.createOscillator();
      var volume = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(90, frequency * 0.62),
        audio.currentTime + (duration || 0.1),
      );
      volume.gain.setValueAtTime(0.045, audio.currentTime);
      volume.gain.exponentialRampToValueAtTime(
        0.001,
        audio.currentTime + (duration || 0.1),
      );
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + (duration || 0.1));
    }

    function unlockAudio() {
      if (!audio) {
        var AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) audio = new AudioCtor();
      }
      if (audio) audio.resume();
    }

    function confetti(x, y, amount) {
      if (reduceMotion) return;
      var colors = [
        game.theme.accent,
        game.theme.secondary,
        "#e9c46a",
        "#ffffff",
      ];
      for (var i = 0; i < amount; i += 1) {
        pieces.push({
          x: x,
          y: y,
          vx: (Math.random() - 0.5) * 5,
          vy: -Math.random() * 5 - 1,
          life: 1,
          color: colors[i % colors.length],
        });
      }
    }

    function completed() {
      return game.rules.objectives.filter(function (objective) {
        if (objective.type === "hit") {
          return (hits.get(objective.targetId) || 0) >= objective.count;
        }
        if (objective.type === "collect") {
          return (
            game.entities.filter(function (entity) {
              return entity.type === "collectible";
            }).length === collected.size
          );
        }
        return reached.has(objective.targetId);
      }).length;
    }

    function updateHud() {
      scoreNode.textContent = game.rules.scoreEnabled
        ? score + " Punkte"
        : "Viel Spaß!";
      timeNode.textContent =
        game.rules.timeLimit > 0
          ? Math.max(0, Math.ceil(game.rules.timeLimit - elapsed)) + " s"
          : "Freies Spiel";
      if (phase === "won" || phase === "lost") {
        message.classList.add("show");
        messageTitle.textContent =
          phase === "won" ? "Geschafft!" : "Zeit vorbei";
        messageCopy.textContent =
          phase === "won"
            ? "Das war herrlich wackelig."
            : "Mit „Neu“ geht es direkt noch einmal.";
      } else {
        message.classList.remove("show");
      }
    }

    function finishIfReady() {
      if (
        phase === "running" &&
        game.rules.objectives.length > 0 &&
        completed() === game.rules.objectives.length
      ) {
        running = false;
        phase = "won";
        score += Math.max(0, Math.round(500 - elapsed * 4));
        confetti(game.viewport.width / 2, game.viewport.height / 2, 90);
        tone(740, 0.3);
        updateHud();
      }
    }

    function addRagdoll() {
      var x = game.character.x;
      var y = game.character.y;
      var s = game.character.scale;
      var group = M.Body.nextGroup(true);
      var options = {
        collisionFilter: { group: group },
        friction: 0.6,
        frictionAir: 0.018,
        restitution: 0.18,
        density: 0.0018,
        chamfer: { radius: 10 * s },
      };
      function part(label, px, py, width, height, kind, angle, side) {
        var body =
          kind === "head"
            ? M.Bodies.circle(px, py, width / 2, {
                ...options,
                label: "ragdoll:" + label,
              })
            : M.Bodies.rectangle(px, py, width, height, {
                ...options,
                angle: angle || 0,
                label: "ragdoll:" + label,
              });
        shapes.set(body.id, {
          kind: kind,
          width: width,
          height: height,
          side: side,
        });
        ragdoll.push(body);
        return body;
      }
      var head = part("head", x, y - 64 * s, 42 * s, 42 * s, "head");
      var torso = part("torso", x, y - 12 * s, 46 * s, 68 * s, "torso");
      var lua = part(
        "left-upper-arm",
        x - 34 * s,
        y - 18 * s,
        17 * s,
        43 * s,
        "arm",
        0.22,
        "left",
      );
      var lla = part(
        "left-lower-arm",
        x - 45 * s,
        y + 21 * s,
        15 * s,
        42 * s,
        "arm",
        0.12,
        "left",
      );
      var rua = part(
        "right-upper-arm",
        x + 34 * s,
        y - 18 * s,
        17 * s,
        43 * s,
        "arm",
        -0.22,
        "right",
      );
      var rla = part(
        "right-lower-arm",
        x + 45 * s,
        y + 21 * s,
        15 * s,
        42 * s,
        "arm",
        -0.12,
        "right",
      );
      var lul = part(
        "left-upper-leg",
        x - 14 * s,
        y + 47 * s,
        21 * s,
        51 * s,
        "leg",
        0.05,
        "left",
      );
      var lll = part(
        "left-lower-leg",
        x - 15 * s,
        y + 94 * s,
        19 * s,
        48 * s,
        "leg",
        0.02,
        "left",
      );
      var rul = part(
        "right-upper-leg",
        x + 14 * s,
        y + 47 * s,
        21 * s,
        51 * s,
        "leg",
        -0.05,
        "right",
      );
      var rll = part(
        "right-lower-leg",
        x + 15 * s,
        y + 94 * s,
        19 * s,
        48 * s,
        "leg",
        -0.02,
        "right",
      );
      function joint(a, b, pointA, pointB, stiffness) {
        return M.Constraint.create({
          bodyA: a,
          bodyB: b,
          pointA: pointA,
          pointB: pointB,
          length: 0,
          stiffness: stiffness || 0.78,
          damping: 0.12,
        });
      }
      M.Composite.add(engine.world, [
        ...ragdoll,
        joint(torso, head, { x: 0, y: -31 * s }, { x: 0, y: 20 * s }),
        joint(
          torso,
          lua,
          { x: -23 * s, y: -23 * s },
          { x: 0, y: -20 * s },
        ),
        joint(lua, lla, { x: 0, y: 20 * s }, { x: 0, y: -19 * s }, 0.7),
        joint(
          torso,
          rua,
          { x: 23 * s, y: -23 * s },
          { x: 0, y: -20 * s },
        ),
        joint(rua, rla, { x: 0, y: 20 * s }, { x: 0, y: -19 * s }, 0.7),
        joint(
          torso,
          lul,
          { x: -13 * s, y: 32 * s },
          { x: 0, y: -23 * s },
        ),
        joint(lul, lll, { x: 0, y: 23 * s }, { x: 0, y: -22 * s }, 0.72),
        joint(
          torso,
          rul,
          { x: 13 * s, y: 32 * s },
          { x: 0, y: -23 * s },
        ),
        joint(rul, rll, { x: 0, y: 23 * s }, { x: 0, y: -22 * s }, 0.72),
      ]);
    }

    function addEntity(entity) {
      var body;
      var angle = (entity.angle * Math.PI) / 180;
      if (entity.type === "bumper") {
        body = M.Bodies.circle(entity.x, entity.y, entity.radius, {
          isStatic: true,
          restitution: entity.bounce,
          friction: 0.05,
          label: "entity:" + entity.id,
        });
      } else if (entity.type === "collectible") {
        body = M.Bodies.circle(entity.x, entity.y, entity.radius, {
          isStatic: true,
          isSensor: true,
          label: "entity:" + entity.id,
        });
      } else {
        body = M.Bodies.rectangle(
          entity.x,
          entity.y,
          entity.width,
          entity.height,
          {
            isStatic: true,
            isSensor: entity.type === "force" || entity.type === "goal",
            angle: angle,
            restitution: entity.type === "spring" ? 1 : 0.2,
            friction: 0.55,
            chamfer:
              entity.type === "platform" || entity.type === "spring"
                ? { radius: 8 }
                : undefined,
            label: "entity:" + entity.id,
          },
        );
      }
      entities.set(entity.id, body);
      M.Composite.add(engine.world, body);
    }

    function build() {
      var w = game.viewport.width;
      var h = game.viewport.height;
      M.Composite.add(engine.world, [
        M.Bodies.rectangle(w / 2, h + 40, w + 160, 80, {
          isStatic: true,
          label: "boundary",
        }),
        M.Bodies.rectangle(w / 2, -40, w + 160, 80, {
          isStatic: true,
          label: "boundary",
        }),
        M.Bodies.rectangle(-40, h / 2, 80, h + 160, {
          isStatic: true,
          label: "boundary",
        }),
        M.Bodies.rectangle(w + 40, h / 2, 80, h + 160, {
          isStatic: true,
          label: "boundary",
        }),
      ]);
      game.entities.forEach(addEntity);
      addRagdoll();
    }

    function entityFrom(body) {
      if (!body.label.startsWith("entity:")) return null;
      var id = body.label.slice(7);
      return game.entities.find(function (entity) {
        return entity.id === id;
      });
    }

    M.Events.on(engine, "collisionStart", function (event) {
      event.pairs.forEach(function (pair) {
        var aRagdoll = pair.bodyA.label.startsWith("ragdoll:");
        var bRagdoll = pair.bodyB.label.startsWith("ragdoll:");
        if (!aRagdoll && !bRagdoll) return;
        var body = aRagdoll ? pair.bodyA : pair.bodyB;
        var other = aRagdoll ? pair.bodyB : pair.bodyA;
        var entity = entityFrom(other);
        if (!entity) return;
        if (entity.type === "bumper") {
          hits.set(entity.id, (hits.get(entity.id) || 0) + 1);
          score += 10;
          tone(220 + Math.min(180, body.speed * 10));
        }
        if (entity.type === "spring") {
          M.Body.applyForce(body, body.position, {
            x: Math.sin((entity.angle * Math.PI) / 180) * entity.impulse,
            y: -Math.cos((entity.angle * Math.PI) / 180) * entity.impulse,
          });
          score += 15;
          tone(300, 0.13);
        }
        if (entity.type === "collectible" && !collected.has(entity.id)) {
          collected.add(entity.id);
          M.Composite.remove(engine.world, other);
          score += 100;
          confetti(entity.x, entity.y, 20);
          tone(620, 0.14);
        }
        if (
          entity.type === "goal" &&
          body.label === "ragdoll:torso" &&
          !reached.has(entity.id)
        ) {
          reached.add(entity.id);
          score += 250;
          confetti(entity.x, entity.y, 32);
          tone(520, 0.2);
        }
        updateHud();
        finishIfReady();
      });
    });

    M.Events.on(engine, "beforeUpdate", function (event) {
      elapsed += event.delta / 1000;
      game.entities.forEach(function (entity) {
        if (entity.type !== "force") return;
        ragdoll.forEach(function (body) {
          if (
            Math.abs(body.position.x - entity.x) <= entity.width / 2 &&
            Math.abs(body.position.y - entity.y) <= entity.height / 2
          ) {
            M.Body.applyForce(body, body.position, {
              x: entity.forceX,
              y: entity.forceY,
            });
          }
        });
      });
      ragdoll.forEach(function (body) {
        if (body.speed > 26) {
          M.Body.setVelocity(
            body,
            M.Vector.mult(body.velocity, 26 / body.speed),
          );
        }
      });
      if (
        game.rules.timeLimit > 0 &&
        elapsed >= game.rules.timeLimit &&
        phase === "running"
      ) {
        running = false;
        phase = "lost";
        tone(120, 0.28);
      }
      updateHud();
    });

    function rounded(x, y, width, height, radius) {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
    }

    function drawEntity(entity) {
      if (entity.type === "collectible" && collected.has(entity.id)) return;
      ctx.save();
      ctx.translate(entity.x, entity.y);
      ctx.rotate((entity.angle * Math.PI) / 180);
      if (entity.type === "platform") {
        ctx.fillStyle = entity.color;
        rounded(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
          Math.min(10, entity.height / 2),
        );
        ctx.fill();
      } else if (entity.type === "bumper") {
        ctx.fillStyle = entity.color;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.72)";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius - 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.28)";
        ctx.beginPath();
        ctx.arc(
          -entity.radius * 0.28,
          -entity.radius * 0.32,
          entity.radius * 0.2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else if (entity.type === "spring") {
        ctx.fillStyle = entity.color;
        rounded(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
          8,
        );
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (
          var sx = -entity.width / 2 + 12;
          sx < entity.width / 2 - 8;
          sx += 18
        ) {
          ctx.moveTo(sx, 5);
          ctx.lineTo(sx + 9, -5);
          ctx.lineTo(sx + 18, 5);
        }
        ctx.stroke();
      } else if (entity.type === "force") {
        ctx.fillStyle = entity.color + "33";
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 8]);
        ctx.fillRect(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
        );
        ctx.strokeRect(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
        );
        ctx.setLineDash([]);
        ctx.fillStyle = entity.color;
        ctx.font = "700 22px sans-serif";
        ctx.textAlign = "center";
        for (
          var fy = -entity.height / 2 + 30;
          fy < entity.height / 2;
          fy += 48
        ) {
          ctx.fillText("↑", 0, fy);
        }
      } else if (entity.type === "collectible") {
        ctx.fillStyle = entity.color;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.75)";
        [
          [-5, -5],
          [5, -5],
          [-5, 5],
          [5, 5],
        ].forEach(function (hole) {
          ctx.beginPath();
          ctx.arc(hole[0], hole[1], 2.3, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (entity.type === "goal") {
        ctx.fillStyle = entity.color + "38";
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        rounded(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
          18,
        );
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = entity.color;
        ctx.font = "800 24px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("WEICH LANDEN", 0, 8);
      }
      ctx.restore();
    }

    function drawPart(body) {
      var shape = shapes.get(body.id);
      if (!shape) return;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(61,48,39,.18)";
      if (shape.kind === "head") {
        ctx.fillStyle = game.character.fabric;
        ctx.beginPath();
        ctx.arc(0, 0, shape.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#3a3b45";
        ctx.beginPath();
        ctx.arc(-7, -3, 2.2, 0, Math.PI * 2);
        ctx.arc(7, -3, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#665847";
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(0, 2, 8, 0.2, Math.PI - 0.2);
        ctx.stroke();
      } else {
        ctx.fillStyle =
          shape.kind === "leg"
            ? game.character.trousers
            : game.character.sweater;
        rounded(
          -shape.width / 2,
          -shape.height / 2,
          shape.width,
          shape.height,
          Math.min(shape.width / 2, 10),
        );
        ctx.fill();
        ctx.stroke();
        if (shape.kind === "leg" && body.label.includes("lower")) {
          ctx.fillStyle = game.character.shoes;
          ctx.beginPath();
          ctx.ellipse(
            shape.side === "left" ? -4 : 4,
            shape.height / 2 - 1,
            shape.width * 0.72,
            9,
            shape.side === "left" ? -0.18 : 0.18,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      ctx.restore();
    }

    function fit(rect) {
      var scale = Math.min(
        rect.width / game.viewport.width,
        rect.height / game.viewport.height,
      );
      return {
        scale: scale,
        x: (rect.width - game.viewport.width * scale) / 2,
        y: (rect.height - game.viewport.height * scale) / 2,
      };
    }

    function render() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var width = Math.max(1, Math.round(rect.width * dpr));
      var height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      var camera = fit(rect);
      ctx.setTransform(
        dpr * camera.scale,
        0,
        0,
        dpr * camera.scale,
        dpr * camera.x,
        dpr * camera.y,
      );
      ctx.fillStyle = game.viewport.background;
      ctx.fillRect(0, 0, game.viewport.width, game.viewport.height);
      ctx.fillStyle = "rgba(255,255,255,.34)";
      for (var x = 24; x < game.viewport.width; x += 48) {
        for (var y = 24; y < game.viewport.height; y += 48) {
          ctx.beginPath();
          ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      game.entities.forEach(drawEntity);
      ragdoll
        .filter(function (body) {
          return body.label.includes("leg");
        })
        .forEach(drawPart);
      ragdoll
        .filter(function (body) {
          return body.label.includes("arm");
        })
        .forEach(drawPart);
      ragdoll
        .filter(function (body) {
          return body.label === "ragdoll:torso";
        })
        .forEach(drawPart);
      ragdoll
        .filter(function (body) {
          return body.label === "ragdoll:head";
        })
        .forEach(drawPart);
      pieces.forEach(function (piece) {
        ctx.fillStyle = piece.color;
        ctx.fillRect(piece.x - 4, piece.y - 2, 8, 4);
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.vy += 0.12;
        piece.life -= 0.014;
      });
      pieces = pieces.filter(function (piece) {
        return piece.life > 0;
      });
    }

    function point(event) {
      var rect = canvas.getBoundingClientRect();
      var camera = fit(rect);
      return {
        x: (event.clientX - rect.left - camera.x) / camera.scale,
        y: (event.clientY - rect.top - camera.y) / camera.scale,
      };
    }

    function release() {
      if (drag) M.Composite.remove(engine.world, drag);
      drag = null;
      pointer = null;
    }

    canvas.addEventListener("pointerdown", function (event) {
      if (pointer !== null || phase !== "running") return;
      unlockAudio();
      var p = point(event);
      var body = M.Query.point(ragdoll, p).at(-1);
      if (!body) return;
      pointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      drag = M.Constraint.create({
        pointA: p,
        bodyB: body,
        pointB: M.Vector.rotate(
          M.Vector.sub(p, body.position),
          -body.angle,
        ),
        length: 0,
        stiffness: 0.23,
        damping: 0.16,
      });
      M.Composite.add(engine.world, drag);
    });
    canvas.addEventListener("pointermove", function (event) {
      if (pointer === event.pointerId && drag) drag.pointA = point(event);
    });
    canvas.addEventListener("pointerup", function (event) {
      if (pointer === event.pointerId) release();
    });
    canvas.addEventListener("pointercancel", release);

    pauseButton.addEventListener("click", function () {
      unlockAudio();
      if (phase === "won" || phase === "lost") return;
      running = !running;
      phase = running ? "running" : "paused";
      pauseButton.textContent = running ? "⏸ Pause" : "▶ Weiter";
      last = performance.now();
      updateHud();
    });
    muteButton.addEventListener("click", function () {
      unlockAudio();
      muted = !muted;
      muteButton.textContent = muted ? "🔇 Stumm" : "🔊 Ton";
    });
    resetButton.addEventListener("click", function () {
      release();
      M.Composite.clear(engine.world, false, true);
      ragdoll.length = 0;
      shapes.clear();
      entities.clear();
      collected.clear();
      reached.clear();
      hits.clear();
      pieces.length = 0;
      score = 0;
      elapsed = 0;
      accumulator = 0;
      phase = "running";
      running = true;
      pauseButton.textContent = "⏸ Pause";
      build();
      updateHud();
    });

    function frame(now) {
      var delta = Math.min(100, now - last);
      last = now;
      if (running) {
        accumulator += delta;
        while (accumulator >= step) {
          M.Engine.update(engine, step);
          accumulator -= step;
        }
      }
      render();
      requestAnimationFrame(frame);
    }

    build();
    updateHud();
    requestAnimationFrame(frame);
  };
})();
