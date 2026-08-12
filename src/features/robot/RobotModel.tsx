import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { MathUtils } from 'three';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { JointId } from '../../types/domain';
import { toGeometricAngles } from './servoMapping';

interface RobotModelProps {
  engine: SimulationEngine;
  activeJointId?: JointId;
}

const COLORS = {
  base: '#263746',
  link: '#648199',
  joint: '#1cbbc2',
  activeJoint: '#f5b74c',
  tool: '#ef6e5b',
} as const;

export function RobotModel({
  engine,
  activeJointId,
}: RobotModelProps) {
  const baseYawRef = useRef<Group>(null);
  const shoulderRollRef = useRef<Group>(null);
  const shoulderRef = useRef<Group>(null);
  const elbowRef = useRef<Group>(null);
  const wristRef = useRef<Group>(null);
  const challenge = engine.getChallenge();
  const geometry = challenge.robotConfig.geometry;

  useFrame(() => {
    // Servo degrees in, geometric rotations out — the same conversion
    // `computeRobotPose` does, because this is the one consumer that builds its
    // transform from the angles directly rather than from a pose. Skipping it
    // here would draw an arm that disagreed with the arm being scored.
    const angles = toGeometricAngles(
      challenge.robotConfig,
      engine.robotController.getAngles(),
    );

    if (baseYawRef.current) {
      baseYawRef.current.rotation.y = MathUtils.degToRad(angles.baseYaw);
    }
    if (shoulderRollRef.current) {
      shoulderRollRef.current.rotation.x = MathUtils.degToRad(
        angles.shoulderRoll,
      );
    }
    if (shoulderRef.current) {
      shoulderRef.current.rotation.z = MathUtils.degToRad(
        angles.shoulder,
      );
    }
    if (elbowRef.current) {
      elbowRef.current.rotation.z = MathUtils.degToRad(angles.elbow);
    }
    if (wristRef.current) {
      wristRef.current.rotation.z = MathUtils.degToRad(angles.wrist);
    }
  });

  return (
    <group position={geometry.basePosition}>
      <mesh
        castShadow
        receiveShadow
        position={[0, geometry.shoulderHeight / 2, 0]}
      >
        <cylinderGeometry
          args={[0.28, 0.34, geometry.shoulderHeight, 24]}
        />
        <meshStandardMaterial color={COLORS.base} roughness={0.58} />
      </mesh>

      <group
        ref={baseYawRef}
        position={[0, geometry.shoulderHeight, 0]}
      >
        <Joint
          active={activeJointId === 'baseYaw'}
          scale={0.18}
        />
        <group ref={shoulderRollRef}>
          <ShoulderRollJoint
            active={activeJointId === 'shoulderRoll'}
          />
          <group ref={shoulderRef}>
            <Joint
              active={activeJointId === 'shoulder'}
              scale={0.13}
            />
            <Link length={geometry.upperArmLength} />
            <group
              ref={elbowRef}
              position={[geometry.upperArmLength, 0, 0]}
            >
              <Joint
                active={activeJointId === 'elbow'}
                scale={0.15}
              />
              <Link length={geometry.forearmLength} />
              <group
                ref={wristRef}
                position={[geometry.forearmLength, 0, 0]}
              >
                <Joint
                  active={activeJointId === 'wrist'}
                  scale={0.13}
                />
                <Tool
                  length={geometry.toolLength}
                  radius={geometry.toolRadius}
                />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function ShoulderRollJoint({ active }: { active: boolean }) {
  return (
    <mesh castShadow rotation={[0, Math.PI / 2, 0]}>
      <torusGeometry args={[0.2, 0.045, 12, 28]} />
      <meshStandardMaterial
        color={active ? COLORS.activeJoint : COLORS.joint}
        emissive={active ? COLORS.activeJoint : '#000000'}
        emissiveIntensity={active ? 0.22 : 0}
        metalness={0.36}
        roughness={0.3}
      />
    </mesh>
  );
}

function Link({ length }: { length: number }) {
  return (
    <mesh castShadow receiveShadow position={[length / 2, 0, 0]}>
      <boxGeometry args={[length, 0.13, 0.13]} />
      <meshStandardMaterial
        color={COLORS.link}
        metalness={0.35}
        roughness={0.36}
      />
    </mesh>
  );
}

function Joint({
  active,
  scale,
}: {
  active: boolean;
  scale: number;
}) {
  return (
    <mesh castShadow>
      <sphereGeometry args={[scale, 24, 18]} />
      <meshStandardMaterial
        color={active ? COLORS.activeJoint : COLORS.joint}
        emissive={active ? COLORS.activeJoint : '#000000'}
        emissiveIntensity={active ? 0.22 : 0}
        metalness={0.28}
        roughness={0.32}
      />
    </mesh>
  );
}

function Tool({ length, radius }: { length: number; radius: number }) {
  return (
    <group>
      <mesh
        castShadow
        position={[length / 2, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.055, 0.075, length, 16]} />
        <meshStandardMaterial
          color="#aebdca"
          metalness={0.7}
          roughness={0.25}
        />
      </mesh>
      <mesh
        castShadow
        position={[length, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <sphereGeometry args={[radius, 24, 18]} />
        <meshStandardMaterial
          color={COLORS.tool}
          emissive={COLORS.tool}
          emissiveIntensity={0.18}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}
